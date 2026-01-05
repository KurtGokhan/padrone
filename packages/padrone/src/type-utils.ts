import type { AnyPadroneCommand } from './types';

/**
 * Use this type instead of `any` when you intend to fix it later
 * @deprecated Please replace with an actual type
 */
export type TODO<TCast = any, _TReason = unknown> = TCast;

export type SafeString = string & {};
export type IsUnknown<T> = unknown extends T ? true : false;
type IsAny<T> = any extends T ? true : false;
type IsNever<T> = [T] extends [never] ? true : false;

type SplitString<TName extends string, TSplitBy extends string = ' '> = TName extends `${infer FirstPart}${TSplitBy}${infer RestParts}`
  ? [FirstPart, ...SplitString<RestParts, TSplitBy>]
  : [TName];

type JoinString<TParts extends string[], TJoinBy extends string = ' '> = TParts extends [
  infer FirstPart extends string,
  ...infer RestParts extends string[],
]
  ? RestParts extends []
    ? FirstPart
    : `${FirstPart}${TJoinBy}${JoinString<RestParts, TJoinBy>}`
  : TParts extends []
    ? ''
    : TParts[number];

type SplitLastSpace<S extends string> =
  SplitString<S> extends [...infer Init extends string[], infer Last extends string]
    ? Init extends []
      ? [S, never]
      : [JoinString<Init>, Last]
    : [S, never];

type AnyPartExtends<U, T> = [U] extends [never] ? false : U extends any ? (U extends T ? true : never) : never extends true ? true : false;

export type FullCommandName<TName extends string, TParentName extends string = ''> = TParentName extends ''
  ? TName
  : `${TParentName} ${TName}`;

/**
 * Generate full alias paths by combining parent path with each alias.
 */
type FullAliasPaths<TAliases extends string[], TParentName extends string = ''> = TAliases extends [
  infer First extends string,
  ...infer Rest extends string[],
]
  ? FullCommandName<First, TParentName> | FullAliasPaths<Rest, TParentName>
  : never;

/**
 * Get all paths for a command including its primary path and all alias paths.
 */
type GetCommandPathsAndAliases<TCommand extends AnyPadroneCommand> = TCommand['~types']['path'] extends infer Path extends string
  ? TCommand['~types']['aliases'] extends infer Aliases extends string[]
    ? TCommand['~types']['parentName'] extends infer ParentName extends string
      ? Path | FullAliasPaths<Aliases, ParentName>
      : Path
    : Path
  : never;

export type PickCommandByName<
  TCommands extends AnyPadroneCommand[],
  TName extends string | AnyPadroneCommand,
> = TName extends AnyPadroneCommand
  ? TName
  : FlattenCommands<TCommands> extends infer Cmd extends AnyPadroneCommand
    ? Cmd extends AnyPadroneCommand
      ? TName extends GetCommandPathsAndAliases<Cmd>
        ? Cmd
        : never
      : never
    : never;

export type FlattenCommands<TCommands extends AnyPadroneCommand[]> = TCommands extends []
  ? never
  : TCommands extends [infer FirstCommand, ...infer RestCommands]
    ?
        | (RestCommands extends AnyPadroneCommand[] ? FlattenCommands<RestCommands> : never)
        | (FirstCommand extends AnyPadroneCommand ? FlattenCommands<FirstCommand['~types']['commands']> | FirstCommand : never)
    : IsAny<TCommands[number]> extends true
      ? never
      : TCommands[number];

export type GetCommandPaths<TCommands extends AnyPadroneCommand[]> = FlattenCommands<TCommands>['path'];

/**
 * Get all command paths including alias paths for all commands.
 */
export type GetCommandPathsOrAliases<TCommands extends AnyPadroneCommand[]> = GetCommandPathsAndAliases<FlattenCommands<TCommands>>;

/**
 * Find all the commands that are prefixed with a command name or alias.
 * This is needed to avoid matching other commands when followed by a space and another word.
 * For example, let's say `level1` and `level1 level2` are commands.
 * Then `level1 ${string}` would also match `level1 level2`,
 * and it would cause `level1 level2` to not show up in the autocomplete.
 * By excluding those cases, we can ensure autocomplete works correctly.
 */
type PrefixedCommands<TCommands extends AnyPadroneCommand[]> =
  GetCommandPathsOrAliases<TCommands> extends infer CommandNames
    ? CommandNames extends string
      ? AnyPartExtends<GetCommandPathsOrAliases<TCommands>, `${CommandNames} ${string}`> extends true
        ? never
        : `${CommandNames} ${string}`
      : never
    : never;

/**
 * The possible commands are the commands that can be parsed by the program.
 * This includes the string that are exact matches to a command name or alias, and strings that are prefixed with a command name or alias.
 */
export type PossibleCommands<TCommands extends AnyPadroneCommand[]> =
  | GetCommandPathsOrAliases<TCommands>
  | PrefixedCommands<TCommands>
  | SafeString;

/**
 * Match a string to a command by the possible commands.
 * This is done by recursively splitting the string by the last space, and then checking if the prefix is a valid command name or alias.
 * This is needed to avoid matching the top-level command when there are nested commands.
 */
export type PickCommandByPossibleCommands<
  TCommands extends AnyPadroneCommand[],
  TCommand extends PossibleCommands<TCommands>,
> = IsAny<TCommand> extends true
  ? TCommands[number]
  : TCommand extends GetCommandPathsOrAliases<TCommands>
    ? PickCommandByName<TCommands, TCommand>
    : SplitLastSpace<TCommand> extends [infer Prefix extends string, infer Rest]
      ? IsNever<Rest> extends true
        ? PickCommandByName<TCommands, Prefix>
        : PickCommandByPossibleCommands<TCommands, Prefix>
      : never;
