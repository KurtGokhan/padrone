import type { AnyZodrunCommand } from './types';

export type IsUnknown<T> = unknown extends T ? true : false;

export type PickCommandByName<
  TCommands extends AnyZodrunCommand[],
  TName extends string,
> = TName extends `${infer FirstPart} ${infer RestParts}`
  ? PickCommandByName<PickCommandByNameSingle<TCommands, FirstPart>['~types']['commands'], RestParts>
  : PickCommandByNameSingle<TCommands, TName>;

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
        | FirstCommand['name']
        | (FirstCommand['~types']['commands'] extends AnyZodrunCommand[]
            ? `${FirstCommand['name']} ${GetCommandNames<FirstCommand['~types']['commands']>}`
            : never)
        | (RestCommands extends AnyZodrunCommand[] ? GetCommandNames<RestCommands> : never)
    : never
  : never;

export type SplitString<
  TName extends string,
  TSplitBy extends string = ' ',
> = TName extends `${infer FirstPart}${TSplitBy}${infer RestParts}` ? [FirstPart, ...SplitString<RestParts, TSplitBy>] : [TName];
