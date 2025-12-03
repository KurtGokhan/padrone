import type { AnyZodrunCommand } from './types';

/**
 * Use this type instead of `any` when you intend to fix it later
 * @deprecated Please replace with an actual type
 */
export type TODO<TCast = any, _TReason = unknown> = TCast;

type SafeString = string & {};
export type IsUnknown<T> = unknown extends T ? true : false;

export type FullCommandName<TName extends string, TParentName extends string = ''> = TParentName extends ''
  ? TName
  : `${TParentName} ${TName}`;

export type PickCommandByName<
  TCommands extends AnyZodrunCommand[],
  TName extends string | AnyZodrunCommand,
> = TName extends AnyZodrunCommand
  ? TName
  : string extends TName
    ? TCommands[number]
    : TName extends `${infer FirstPart} ${infer RestParts}`
      ? PickCommandByName<PickCommandByNameSingle<TCommands, FirstPart>['~types']['commands'], RestParts>
      : TName extends string
        ? PickCommandByNameSingle<TCommands, TName>
        : never;

type PickCommandByNameSingle<TCommands extends AnyZodrunCommand[], TName extends string> = TCommands extends [
  infer FirstCommand,
  ...infer RestCommands,
]
  ? FirstCommand extends AnyZodrunCommand
    ? FirstCommand['name'] extends TName
      ? FirstCommand
      : RestCommands extends AnyZodrunCommand[]
        ? PickCommandByNameSingle<RestCommands, TName>
        : never
    : never
  : never;

export type GetCommandNames<TCommands extends AnyZodrunCommand[]> = TCommands extends [infer FirstCommand, ...infer RestCommands]
  ? FirstCommand extends AnyZodrunCommand
    ?
        | (RestCommands extends AnyZodrunCommand[] ? GetCommandNames<RestCommands> : never)
        | GetCommandNames<FirstCommand['~types']['commands']>
        | FirstCommand['fullName']
    : RestCommands extends AnyZodrunCommand[]
      ? GetCommandNames<RestCommands>
      : never
  : TCommands[number]['fullName'];

export type SplitString<
  TName extends string,
  TSplitBy extends string = ' ',
> = TName extends `${infer FirstPart}${TSplitBy}${infer RestParts}` ? [FirstPart, ...SplitString<RestParts, TSplitBy>] : [TName];

export type PossibleCommands<TCommands extends AnyZodrunCommand[]> =
  | GetCommandNames<TCommands>
  | `${GetCommandNames<TCommands>} ${string}`
  | SafeString;

export type PickCommandByPossibleCommands<
  TCommands extends AnyZodrunCommand[],
  TCommand extends PossibleCommands<TCommands>,
> = TCommand extends GetCommandNames<TCommands>
  ? PickCommandByName<TCommands, TCommand>
  : TCommand extends `${infer TC extends GetCommandNames<TCommands>} ${string}`
    ? PickCommandByName<TCommands, TC>
    : TCommands[number];
