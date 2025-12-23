// Super simple greeter - just echo
import { Host } from '@extism/as-pdk';

export function myAbort(
  message: string | null,
  fileName: string | null,
  lineNumber: u32,
  columnNumber: u32
): void { }

export function execute(): i32 {
  const input = Host.inputString();
  const greeting = "Hello from Loom!";
  const timestamp = 1734156009; // Static timestamp for now
  const length = greeting.length;
  const output = `{"greeting":"${greeting}","timestamp":${timestamp},"length":${length}}`;
  Host.outputString(output);
  return 0;
}
