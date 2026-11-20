/// `npm run package:mac:notarized`: a Developer ID signed, notarized and stapled
/// macOS build, for a machine that holds the certificate. The default `package`
/// stays ad-hoc signed (electron-builder.yml §mac), which is all CI can produce.
///
/// Two values come from the environment, so no identity is written in the repo:
///   LMCUT_MAC_IDENTITY    the certificate's full name as `security find-identity
///                         -v -p codesigning` prints it ("Developer ID Application: …")
///   LMCUT_NOTARY_PROFILE  a keychain profile made once with
///                         `xcrun notarytool store-credentials <name>`
///
/// The app is notarized and stapled first and the DMG is built around it
/// afterwards, by hdiutil rather than electron-builder: packing through
/// electron-builder would sign the app again, and a new signature is a new code
/// hash the stapled ticket no longer covers. The DMG then gets its own signature
/// and ticket, so both the image and the app copied out of it pass Gatekeeper
/// offline.
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url))) // apps/desktop
const PRODUCT = 'LMCut'
const APP = path.join(ROOT, 'release', 'mac-arm64', `${PRODUCT}.app`)
const DMG = path.join(ROOT, 'release', `${PRODUCT}-mac-arm64.dmg`)
const PREFIX = 'Developer ID Application: '

function fail(message) {
  console.error(`package:mac:notarized: ${message}`)
  process.exit(1)
}

function run(command, args, options = {}) {
  console.log(`\n> ${command} ${args.join(' ')}`)
  const result = spawnSync(command, args, { cwd: ROOT, stdio: 'inherit', ...options })
  if (result.status !== 0) fail(`${command} exited with ${result.status ?? result.signal}`)
}

if (process.platform !== 'darwin') fail('this build can only be made on macOS')
const identity = process.env.LMCUT_MAC_IDENTITY
const profile = process.env.LMCUT_NOTARY_PROFILE
if (!identity?.startsWith(PREFIX)) fail(`set LMCUT_MAC_IDENTITY to a "${PREFIX}…" certificate name`)
if (!profile) fail('set LMCUT_NOTARY_PROFILE to a notarytool keychain profile')

/// Submit, wait for the verdict, and print Apple's log when it is not Accepted:
/// the log names the offending file, which the one-word status does not.
function notarize(file) {
  console.log(`\n> xcrun notarytool submit ${path.relative(ROOT, file)}`)
  const result = spawnSync(
    'xcrun',
    ['notarytool', 'submit', file, '--keychain-profile', profile, '--wait', '--timeout', '30m', '--output-format', 'json'],
    { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] },
  )
  let verdict
  try { verdict = JSON.parse(result.stdout) } catch { fail(`notarytool gave no verdict:\n${result.stdout}`) }
  console.log(`  ${verdict.id}: ${verdict.status}`)
  if (verdict.status !== 'Accepted') {
    spawnSync('xcrun', ['notarytool', 'log', verdict.id, '--keychain-profile', profile], { stdio: 'inherit' })
    fail(`Apple did not accept ${path.basename(file)} (${verdict.status})`)
  }
}

// 1. The signed app. electron-builder takes the certificate name without its
//    type prefix, and its own notarize step stays off: it submits and waits in
//    one call, so a dropped connection during the wait fails the whole build.
fs.rmSync(path.join(ROOT, 'release', 'mac-arm64'), { recursive: true, force: true })
run('npx', [
  'electron-builder', '--mac', '--dir', '--publish', 'never',
  `-c.mac.identity=${identity.slice(PREFIX.length)}`, '-c.mac.notarize=false',
])
run('codesign', ['--verify', '--deep', '--strict', APP])

// 2. Its ticket. notarytool takes an archive, not a bundle; ditto keeps the
//    bundle's symlinks and extended attributes, which zip does not.
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'lmcut-notarize-'))
try {
  const zip = path.join(work, `${PRODUCT}.zip`)
  run('ditto', ['-c', '-k', '--keepParent', APP, zip])
  notarize(zip)
  run('xcrun', ['stapler', 'staple', APP])

  // 3. The image: the app beside an Applications link, as a user expects.
  const stage = path.join(work, 'dmg')
  fs.mkdirSync(stage)
  run('ditto', [APP, path.join(stage, `${PRODUCT}.app`)])
  fs.symlinkSync('/Applications', path.join(stage, 'Applications'))
  fs.rmSync(DMG, { force: true })
  run('hdiutil', ['create', '-volname', PRODUCT, '-srcfolder', stage, '-fs', 'APFS', '-format', 'UDZO', '-ov', DMG])
} finally {
  fs.rmSync(work, { recursive: true, force: true })
}
run('codesign', ['--force', '--timestamp', '--sign', identity, DMG])
notarize(DMG)
run('xcrun', ['stapler', 'staple', DMG])

// 4. What a downloading user's Mac will decide.
run('spctl', ['--assess', '--type', 'execute', '--verbose=2', APP])
run('spctl', ['--assess', '--type', 'open', '--context', 'context:primary-signature', '--verbose=2', DMG])
console.log(`\npackage:mac:notarized: ${path.relative(ROOT, DMG)} is signed, notarized and stapled`)
