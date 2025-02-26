import { CheckConcern } from "../types";

export function getConcernList(platformName: string): [CheckConcern[], (text: string, level?: 'warn'|'fix'|'error') => void] {
  const list: CheckConcern[] = [];
  const add = (text: string, level: 'warn'|'fix'|'error' = 'fix') => {
    list.push({ platform: platformName, concern: text, level });
  };
  return [ list, add ];
}
