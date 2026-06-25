// format-tool-message.ts -- one-line human-readable summary of a tool call,
// for Argus's `message` column. Previously `message` was just the bare tool
// name (e.g. "Bash"), which duplicated information already implied by the
// event itself and told you nothing about what actually happened.
//
// Pure function, no I/O — keeps ToolActivityTracker.hook.ts thin.

import { basename } from 'path';

const TRUNCATE_LEN = 60;

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max) + '…' : s;
}

export function formatToolMessage(
  toolName: string,
  toolInput: Record<string, unknown> | undefined
): string {
  if (!toolInput) return toolName;

  switch (toolName) {
    case 'Bash': {
      const command = toolInput.command;
      return typeof command === 'string' ? `Bash: ${truncate(command, TRUNCATE_LEN)}` : toolName;
    }
    case 'Edit':
    case 'Write':
    case 'MultiEdit': {
      const filePath = toolInput.file_path;
      return typeof filePath === 'string' ? `${toolName}: ${basename(filePath)}` : toolName;
    }
    case 'NotebookEdit': {
      const filePath = toolInput.notebook_path;
      return typeof filePath === 'string' ? `NotebookEdit: ${basename(filePath)}` : toolName;
    }
    case 'Read': {
      const filePath = toolInput.file_path;
      return typeof filePath === 'string' ? `Read: ${basename(filePath)}` : toolName;
    }
    case 'Grep': {
      const pattern = toolInput.pattern;
      return typeof pattern === 'string' ? `Grep: ${truncate(pattern, TRUNCATE_LEN)}` : toolName;
    }
    case 'Glob': {
      const pattern = toolInput.pattern;
      return typeof pattern === 'string' ? `Glob: ${pattern}` : toolName;
    }
    case 'WebFetch': {
      const url = toolInput.url;
      return typeof url === 'string' ? `WebFetch: ${truncate(url, TRUNCATE_LEN)}` : toolName;
    }
    case 'WebSearch': {
      const query = toolInput.query;
      return typeof query === 'string' ? `WebSearch: ${truncate(query, TRUNCATE_LEN)}` : toolName;
    }
    default:
      return toolName;
  }
}
