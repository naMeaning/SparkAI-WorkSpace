export type ComposerCommandName = "goal" | "config" | "status" | "help" | "new" | "pause" | "resume" | "stop";
export type ComposerCommand = { name: ComposerCommandName; usage: string; description: string; takesArgument?: boolean };
export type ComposerInput = { kind: "text"; text: string } | { kind: "unknown"; name: string } | { kind: "command"; name: ComposerCommandName; argument: string };
export const composerCommands: readonly ComposerCommand[];
export function parseComposerInput(value: string): ComposerInput;
export function composerCommandSuggestions(value: string): ComposerCommand[];
export function composerCommandError(input: ComposerInput, state: { busy: boolean; paused: boolean; stopPending: boolean; goalActive: boolean; goalAvailable: boolean }): string;
