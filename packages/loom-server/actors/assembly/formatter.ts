// Actor 3: Formatter - Formats text with styling and case transformations
import { Host, JSON } from "@extism/as-pdk";

export function execute(): i32 {
  const input = Host.inputString();
  const data = JSON.parse<InputData>(input);
  
  const text = data.text;
  const style = data.style;
  
  let formatted = text;
  
  // Apply transformation based on style
  if (style === "uppercase") {
    formatted = text.toUpperCase();
  } else if (style === "lowercase") {
    formatted = text.toLowerCase();
  } else if (style === "title") {
    formatted = toTitleCase(text);
  } else if (style === "reverse") {
    formatted = reverseString(text);
  } else if (style === "emoji") {
    formatted = `🎉 ${text} 🚀`;
  }
  
  const output = new OutputData();
  output.original = text;
  output.formatted = formatted;
  output.style = style;
  output.transformation = `Applied ${style} style`;
  output.length = formatted.length;
  
  Host.outputString(JSON.stringify(output));
  return 0;
}

function toTitleCase(text: string): string {
  const words = text.split(" ");
  let result = "";
  for (let i = 0; i < words.length; i++) {
    const word = words[i];
    if (word.length > 0) {
      result += word.charAt(0).toUpperCase() + word.substring(1).toLowerCase();
      if (i < words.length - 1) result += " ";
    }
  }
  return result;
}

function reverseString(text: string): string {
  let result = "";
  for (let i = text.length - 1; i >= 0; i--) {
    result += text.charAt(i);
  }
  return result;
}

@json
class InputData {
  text!: string;
  style!: string;
}

@json
class OutputData {
  original!: string;
  formatted!: string;
  style!: string;
  transformation!: string;
  length!: i32;
}
