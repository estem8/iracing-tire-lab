/**
 * What the app asks of the operating system: a file dialog, whether iRacing is
 * running, the command that turns iRacing's telemetry recording on or off, and
 * a browser. Behind an interface so the server can be tested without a desktop.
 * The Windows implementation drives PowerShell and needs nothing installed.
 */
import { execFile } from 'node:child_process';

export type TelemetryCommand = 'stop' | 'start' | 'restart';

export interface System {
  /** Whether the file dialog and the telemetry switch can work here. */
  readonly canControl: boolean;
  /** A file-open dialog for an .ibt file; undefined when cancelled. */
  pickFile(): Promise<string | undefined>;
  /** Whether an iRacing simulator process is running. */
  iracingRunning(): Promise<boolean>;
  /** Sends iRacing's telemetry command. It cannot say whether recording follows. */
  telemetry(command: TelemetryCommand): Promise<void>;
  openBrowser(url: string): Promise<void>;
}

/**
 * irsdk_BroadcastMsg and irsdk_TelemCommandMode from the iRacing SDK header
 * (irsdk_defines.h, as shipped in irdashies): TelemCommand is the 11th message
 * (10), with Stop = 0, Start = 1, Restart = 2. The sim receives it as a window
 * message broadcast under the name below, with MAKELONG(message, mode) in
 * wParam and 0 in lParam. Recording only happens while the driver is in the car.
 */
export const BROADCAST_NAME = 'IRSDK_BROADCASTMSG';
export const BROADCAST_TELEM_COMMAND = 10;
export const TELEM_MODE: Record<TelemetryCommand, number> = {
  stop: 0,
  start: 1,
  restart: 2,
};

const encode = (script: string): string =>
  Buffer.from(script, 'utf16le').toString('base64');

/** PowerShell source that sends the telemetry command. */
export const telemetryScript = (command: TelemetryCommand): string => `
$ErrorActionPreference = 'Stop'
Add-Type -Namespace Lab -Name Win -MemberDefinition @'
[DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern uint RegisterWindowMessage(string name);
[DllImport("user32.dll", SetLastError = true)] public static extern bool SendNotifyMessage(IntPtr window, uint message, IntPtr wParam, IntPtr lParam);
'@
$id = [Lab.Win]::RegisterWindowMessage('${BROADCAST_NAME}')
if ($id -eq 0) { throw 'RegisterWindowMessage failed' }
$wParam = [IntPtr]([int]${BROADCAST_TELEM_COMMAND} -bor ([int]${TELEM_MODE[command]} -shl 16))
if (-not [Lab.Win]::SendNotifyMessage([IntPtr]0xFFFF, $id, $wParam, [IntPtr]::Zero)) { throw 'SendNotifyMessage failed' }
`;

/** PowerShell source of the file dialog; prints the chosen path, or nothing. */
export const pickScript = (startDir: string): string => `
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
$owner = New-Object System.Windows.Forms.Form -Property @{ TopMost = $true; ShowInTaskbar = $false }
$dialog = New-Object System.Windows.Forms.OpenFileDialog
$dialog.Title = 'Open an iRacing telemetry file'
$dialog.Filter = 'iRacing telemetry (*.ibt)|*.ibt|All files (*.*)|*.*'
$dialog.InitialDirectory = '${startDir.replace(/'/g, "''")}'
if ($dialog.ShowDialog($owner) -eq [System.Windows.Forms.DialogResult]::OK) {
  [Console]::OutputEncoding = [System.Text.Encoding]::UTF8
  [Console]::Out.Write($dialog.FileName)
}
`;

const powershell = (script: string): Promise<string> =>
  new Promise((resolve, reject) => {
    execFile(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-STA',
        '-ExecutionPolicy',
        'Bypass',
        '-EncodedCommand',
        encode(script),
      ],
      { windowsHide: true, maxBuffer: 1 << 20 },
      (error, stdout, stderr) =>
        error
          ? reject(new Error(stderr.trim() || error.message))
          : resolve(stdout),
    );
  });

const run = (file: string, args: string[]): Promise<string> =>
  new Promise((resolve, reject) => {
    execFile(file, args, { windowsHide: true, maxBuffer: 1 << 22 }, (e, out) =>
      e ? reject(e) : resolve(out),
    );
  });

/** The Documents\\iRacing\\telemetry folder, where the sim writes .ibt files. */
export const defaultTelemetryDir = (
  home: string | undefined = process.env.USERPROFILE,
): string => `${home ?? ''}\\Documents\\iRacing\\telemetry`;

export const windowsSystem = (): System => ({
  canControl: true,
  async pickFile() {
    const out = (await powershell(pickScript(defaultTelemetryDir()))).trim();
    return out === '' ? undefined : out;
  },
  async iracingRunning() {
    // The simulator's executable is iRacingSim64DX11.exe or a sibling of it.
    const out = await run('tasklist', ['/FO', 'CSV', '/NH']);
    return /^"iRacingSim/im.test(out);
  },
  async telemetry(command) {
    await powershell(telemetryScript(command));
  },
  async openBrowser(url) {
    await run('rundll32', ['url.dll,FileProtocolHandler', url]);
  },
});

/** Everywhere else: nothing the app needs is available, and it says so. */
export const unsupportedSystem = (): System => {
  const no = (what: string) => async (): Promise<never> => {
    throw new Error(`${what} is only available on Windows`);
  };
  return {
    canControl: false,
    pickFile: no('The file dialog'),
    iracingRunning: async () => false,
    telemetry: no('The telemetry switch'),
    openBrowser: no('Opening a browser'),
  };
};

export const defaultSystem = (): System =>
  process.platform === 'win32' ? windowsSystem() : unsupportedSystem();
