// structureBuilder.ts — converts raw parsed messages into outline nodes.
// TODO: implement in next phase.

import type { ParsedMessage } from './domParser';

export interface OutlineNode {
  id: string;
  label: string;
  element: Element;
}

export function buildOutline(messages: ParsedMessage[]): OutlineNode[] {
  // Stub — returns empty array until structure building is implemented.
  return [];
}
