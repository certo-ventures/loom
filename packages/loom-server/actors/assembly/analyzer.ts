// Actor 2: Text Analyzer - Analyzes text and returns statistics
import { Host, JSON } from "@extism/as-pdk";

export function execute(): i32 {
  const input = Host.inputString();
  const data = JSON.parse<InputData>(input);
  
  const text = data.text;
  
  // Analyze the text
  const words = text.split(" ").filter((w: string) => w.length > 0);
  const chars = text.length;
  const vowels = countVowels(text);
  const consonants = countConsonants(text);
  
  const output = new OutputData();
  output.wordCount = words.length;
  output.charCount = chars;
  output.vowelCount = vowels;
  output.consonantCount = consonants;
  output.averageWordLength = words.length > 0 ? f64(chars) / f64(words.length) : 0;
  output.analysis = `Text contains ${words.length.toString()} words and ${chars.toString()} characters`;
  
  Host.outputString(JSON.stringify(output));
  return 0;
}

function countVowels(text: string): i32 {
  let count = 0;
  const vowels = "aeiouAEIOU";
  for (let i = 0; i < text.length; i++) {
    if (vowels.includes(text.charAt(i))) {
      count++;
    }
  }
  return count;
}

function countConsonants(text: string): i32 {
  let count = 0;
  const consonants = "bcdfghjklmnpqrstvwxyzBCDFGHJKLMNPQRSTVWXYZ";
  for (let i = 0; i < text.length; i++) {
    if (consonants.includes(text.charAt(i))) {
      count++;
    }
  }
  return count;
}

@json
class InputData {
  text!: string;
}

@json
class OutputData {
  wordCount!: i32;
  charCount!: i32;
  vowelCount!: i32;
  consonantCount!: i32;
  averageWordLength!: f64;
  analysis!: string;
}
