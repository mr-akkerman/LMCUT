/// The Windows identity of an LMCut process: the AppUserModelID (taskbar icon,
/// window grouping, notification settings) and the toast activator CLSID (the
/// COM class Windows calls when a notification is clicked). See ADR 0163.
export interface WindowsAppIdentity {
  appUserModelId: string
  toastActivatorClsid: string
}

/// The installed app's identity. Both values are STABLE across releases:
/// changing the AUMID orphans pinned shortcuts and the user's notification
/// settings; changing the CLSID strands notifications already in the
/// notification center.
///
/// `appUserModelId` MUST equal `appId` in electron-builder.yml: the NSIS
/// installer stamps `appId` onto the Start Menu and Desktop shortcuts, and
/// Windows links a window to its shortcut only when the two match (otherwise a
/// blank taskbar icon). appIdentity.test.ts pins them.
export const PACKAGED_WINDOWS_IDENTITY: WindowsAppIdentity = {
  appUserModelId: 'dev.lmcut.desktop',
  toastActivatorClsid: '{1A9AFA21-45F4-44C4-8FE4-54776670BFFC}',
}

/// An unpackaged run's identity. It differs from the installed app's in both
/// fields: Electron gives an unpackaged run its own Start Menu shortcut to a
/// bare electron.exe, and two shortcuts claiming one AUMID let Windows route
/// the installed app's notification clicks through the dev one.
export const DEV_WINDOWS_IDENTITY: WindowsAppIdentity = {
  appUserModelId: 'dev.lmcut.desktop.dev',
  toastActivatorClsid: '{47FADE76-C89D-412C-A1FA-CD03C771ADE2}',
}

export function windowsAppIdentity(packaged: boolean): WindowsAppIdentity {
  return packaged ? PACKAGED_WINDOWS_IDENTITY : DEV_WINDOWS_IDENTITY
}
