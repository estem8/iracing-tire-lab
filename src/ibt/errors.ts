/** Why an .ibt could not be read. `code` lets callers branch without string matching. */
export type IbtErrorCode =
  | 'unreadable'
  | 'bad-signature'
  | 'unsupported-version'
  | 'truncated'
  | 'missing-channels'
  | 'no-session-info';

export class IbtError extends Error {
  readonly code: IbtErrorCode;

  constructor(code: IbtErrorCode, message: string) {
    super(message);
    this.name = 'IbtError';
    this.code = code;
  }
}
