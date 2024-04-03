import { neon } from "@neondatabase/serverless";
import OpenAI from "openai";
import dotEnv from "dotenv";
import fs from "fs/promises";
import path from "path";
import { Tiktoken } from "@dqbd/tiktoken";
import cl100k_base from "@dqbd/tiktoken/encoders/cl100k_base.json";

dotEnv.config();

const dataBaseUrl = process.env.DATABASE_URL;
const openAiKey = process.env.OPENAI_KEY;

if (!dataBaseUrl || !openAiKey) {
  throw new Error("missing environment variables");
}

const openAi = new OpenAI({
  apiKey: openAiKey,
});

const sql = neon(dataBaseUrl);

const encoding = new Tiktoken(
  cl100k_base.bpe_ranks,
  cl100k_base.special_tokens,
  cl100k_base.pat_str
);

// -----------
// Step 1
// Create array with texts and fileName
// return array and save it to a json file
// -----------

type TextFile = {
  filePath: string;
  text: string;
};

async function processFiles(folder: string): Promise<TextFile[]> {
  const files: TextFile[] = [];

  const folderPath = `./data/${folder}`;

  const entries = await fs.readdir(folderPath, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(folderPath, entry.name); //entry.name = "fileName"

    if (entry.isDirectory()) {
      continue;
    }

    const text = await fs.readFile(fullPath, "utf-8");

    files.push({
      filePath: entry.name,
      text,
    });
  }

  return files;
}

// -----------
// Step 2
// tokenized all texts
// -----------

type TextFileToken = TextFile & { token: Uint32Array }; // tableau de nombre mais spécifique.

const tiktokenizer = async (files: TextFile[]): Promise<TextFileToken[]> => {
  const textFileTokens: TextFileToken[] = [];

  for (const file of files) {
    const token: Uint32Array = encoding.encode(file.text);

    textFileTokens.push({
      ...file,
      token,
    });
  }

  return textFileTokens;
};

// 3 shorten tous les textes pour pas qu'ils soient trop grand"

// 4 embed tous les textes

// 5 save nos embeddings dans la base de donnée

async function main() {
  const FOLDER = "nextjs";

  // Create array with texts and fileName and save it to a json file (texts.json)
  const texts = await cache_withFile(
    () => processFiles(FOLDER),
    "./processed/texts.json"
  );

  // tokenized all texts  and save it to a json file (textsTokens.json)
  const textTokens = await cache_withFile(
    () => tiktokenizer(texts),
    "./processed/textsTokens.json"
  );
}

main();

// -----------
// Utils
// -----------

async function cache_withFile<T>(func: () => Promise<T>, filePath: string) {
  try {
    await fs.access(filePath);

    const fileData = await fs.readFile(filePath, "utf-8");
    console.log("🛟 using Cache file");

    return JSON.parse(fileData);
  } catch {
    const data = await func();

    console.log("🚀 writing cache file");

    await fs.writeFile(filePath, JSON.stringify(data));

    return data;
  }
}
