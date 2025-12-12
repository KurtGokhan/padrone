import type { AnyPadroneCommand } from './types';

/**
 * Use this type instead of `any` when you intend to fix it later
 * @deprecated Please replace with an actual type
 */
export type TODO<TCast = any, _TReason = unknown> = TCast;

type SafeString = string & {};
export type IsUnknown<T> = unknown extends T ? true : false;
type IsAny<T> = any extends T ? true : false;
type IsNever<T> = [T] extends [never] ? true : false;

type SplitString<TName extends string, TSplitBy extends string = ' '> = TName extends `${infer FirstPart}${TSplitBy}${infer RestParts}`
  ? [FirstPart, ...SplitString<RestParts, TSplitBy>]
  : [TName];

export type JoinString<TParts extends string[], TJoinBy extends string = ' '> = TParts extends [
  infer FirstPart extends string,
  ...infer RestParts extends string[],
]
  ? RestParts extends []
    ? FirstPart
    : `${FirstPart}${TJoinBy}${JoinString<RestParts, TJoinBy>}`
  : TParts extends []
    ? ''
    : TParts[number];

export type SplitLastSpace<S extends string> =
  SplitString<S> extends [...infer Init extends string[], infer Last extends string]
    ? Init extends []
      ? [S, never]
      : [JoinString<Init>, Last]
    : [S, never];

type AnyPartExtends<U, T> = [U] extends [never] ? false : U extends any ? (U extends T ? true : never) : never extends true ? true : false;

export type FullCommandName<TName extends string, TParentName extends string = ''> = TParentName extends ''
  ? TName
  : `${TParentName} ${TName}`;

export type PickCommandByName<
  TCommands extends AnyPadroneCommand[],
  TName extends string | AnyPadroneCommand,
> = TName extends AnyPadroneCommand ? TName : Extract<FlattenCommands<TCommands>, { fullName: TName }>;

export type FlattenCommands<TCommands extends AnyPadroneCommand[]> = TCommands extends [infer FirstCommand, ...infer RestCommands]
  ? FirstCommand extends AnyPadroneCommand
    ?
        | (RestCommands extends AnyPadroneCommand[] ? FlattenCommands<RestCommands> : never)
        | FlattenCommands<FirstCommand['~types']['commands']>
        | FirstCommand
    : RestCommands extends AnyPadroneCommand[]
      ? FlattenCommands<RestCommands>
      : never
  : TCommands[number];

export type GetCommandNames<TCommands extends AnyPadroneCommand[]> = FlattenCommands<TCommands>['fullName'];

/**
 * Find all the commands that are prefixed with a command name.
 * This is needed to avoid matching other commands when followed by a space and another word.
 * For example, let's say `level1` and `level1 level2` are commands.
 * Then `level1 ${string}` would also match `level1 level2`,
 * and it would cause `level1 level2` to not show up in the autocomplete.
 * By excluding those cases, we can ensure autocomplete works correctly.
 */
type PrefixedCommands<TCommands extends AnyPadroneCommand[]> =
  GetCommandNames<TCommands> extends infer CommandNames
    ? CommandNames extends string
      ? AnyPartExtends<GetCommandNames<TCommands>, `${CommandNames} ${string}`> extends true
        ? never
        : `${CommandNames} ${string}`
      : never
    : never;

/**
 * The possible commands are the commands that can be parsed by the program.
 * This includes the string that are exact matches to a command name, and strings that are prefixed with a command name.
 */
export type PossibleCommands<TCommands extends AnyPadroneCommand[]> = GetCommandNames<TCommands> | PrefixedCommands<TCommands> | SafeString;

/**
 * Match a string to a command by the possible commands.
 * This is done by recursively splitting the string by the last space, and then checking if the prefix is a valid command name.
 * This is needed to avoid matching the top-level command when there are nested commands.
 */
export type PickCommandByPossibleCommands<
  TCommands extends AnyPadroneCommand[],
  TCommand extends PossibleCommands<TCommands>,
> = IsAny<TCommand> extends true
  ? TCommands[number]
  : TCommand extends GetCommandNames<TCommands>
    ? PickCommandByName<TCommands, TCommand>
    : SplitLastSpace<TCommand> extends [infer Prefix extends string, infer Rest]
      ? IsNever<Rest> extends true
        ? PickCommandByName<TCommands, Prefix>
        : PickCommandByPossibleCommands<TCommands, Prefix>
      : never;
