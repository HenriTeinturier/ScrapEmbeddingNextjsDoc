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

  // let i = 0;
  for (const entry of entries) {
    // if (i > 2) {
    //   break;
    // }

    const fullPath = path.join(folderPath, entry.name); //entry.name = "fileName"

    if (entry.isDirectory()) {
      continue;
    }

    const text = await fs.readFile(fullPath, "utf-8");

    files.push({
      filePath: entry.name,
      text,
    });

    // i++;
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
  // let i = 0;

  for (const file of files) {
    const token: Uint32Array = encoding.encode(file.text);
    // if (i < 2) {
    //   // console.log("token", token);
    //   console.log("token create", token);
    // }

    textFileTokens.push({
      ...file,
      token: token,
    });

    // i += 1;
  }

  // console.log("tiktokenizer outbout", textFileTokens[0]);
  return textFileTokens;
};

// -----------
// Step 3
// shorten all texts"
// -----------

const MAX_TOKENS = 500;

async function splitTextToMany(text: TextFileToken): Promise<TextFileToken[]> {
  const sentences = text.text
    .split(". ")
    .map((sentence) => ({
      text: sentence + ". ",
      numberTokens: encoding.encode(sentence).length,
    }))
    .reduce((acc, sentence) => {
      // if the sentence is too long, split it by \n
      if (sentence.numberTokens > MAX_TOKENS) {
        const sentences = sentence.text.split("\n").map((sentence) => ({
          text: sentence + "\n",
          numberTokens: encoding.encode(sentence).length,
        }));

        // check if new sentences is to long, if it's the case, cut every space
        const sentencesTooLong = sentences.filter(
          (sentence) => sentence.numberTokens > MAX_TOKENS
        );

        if (sentencesTooLong.length > 0) {
          const word = sentence.text.split(" ").map((sentence) => ({
            text: sentence + " ",
            numberTokens: encoding.encode(sentence).length,
          }));

          return [...acc, ...word];
        }

        return [...acc, ...sentences];
      }
      return [...acc, sentence];
    }, [] as { text: string; numberTokens: number }[]);

  const chunks: TextFileToken[] = [];

  let tokensSoFar = 0;
  let currentChunks: TextFileToken[] = [];

  for (const sentence of sentences) {
    const numberToken = sentence.numberTokens;

    if (tokensSoFar + numberToken > MAX_TOKENS) {
      const chunkText = currentChunks.map((c) => c.text).join("");
      chunks.push({
        filePath: text.filePath,
        text: chunkText,
        token: new Uint32Array(encoding.encode(chunkText)),
      });

      currentChunks = [];
      tokensSoFar = 0;
    }

    currentChunks.push({
      filePath: text.filePath,
      text: sentence.text,
      token: new Uint32Array(encoding.encode(sentence.text)),
    });

    tokensSoFar += numberToken;
  }

  if (currentChunks.length > 0) {
    const chunkText = currentChunks.map((c) => c.text).join("");
    if (chunkText.length > 100) {
      chunks.push({
        filePath: text.filePath,
        text: chunkText,
        token: new Uint32Array(encoding.encode(chunkText)),
      });
    }
  }

  return chunks;
}

async function splitTexts(texts: TextFileToken[]): Promise<TextFileToken[]> {
  const shortened: TextFileToken[] = [];

  // let i = 0;
  for (const file of texts) {
    // if (i < 3) {
    //   // console.log("file", file);
    //   console.log("legngth ligne 178", file.token.length);
    // }
    if (file.token.length > MAX_TOKENS) {
      // console.log(
      //   "index",
      //   i,
      //   "tokenLenght before split",
      //   Object.keys(file.token).length
      // );
      const chunks = await splitTextToMany(file);
      // if (i < 3) {
      // console.log("chunks", chunks);
      // console.log("chunks after split", chunks);
      // }
      shortened.push(...chunks);
    } else {
      shortened.push(file);
    }
    // i += 1;
  }

  return shortened;
}
// -----------
// 4 embed all texts with openai
// -----------

type TextFileEmbedding = TextFile & { embedding: number[] };

async function processEmbeddings(
  texts: TextFileToken[]
): Promise<TextFileEmbedding[]> {
  const embededs: TextFileEmbedding[] = [];
  let i = 0;

  for await (const file of texts) {
    const result = await openAi.embeddings.create({
      model: "text-embedding-ada-002",
      input: file.text,
      encoding_format: "float",
    });
    const embeddings = result.data[0].embedding;

    embededs.push({
      ...file,
      embedding: embeddings,
    });

    console.log(
      "📀 embedding in progress ...",
      file.filePath,
      i,
      " / ",
      texts.length
    );
    i += 1;
  }

  console.log("🛟 embeding done");
  return embededs;
}

// 5 save nos embeddings dans la base de donnée

async function main() {
  const FOLDER = "nextjs";

  // Step 1 Create array with texts and fileName and save it to a json file (texts.json)
  const texts = await cache_withFile(
    () => processFiles(FOLDER),
    "./processed/texts.json"
  );

  // Step 2 tokenized all texts  and save it to a json file (textsTokens.json)
  const textTokens: TextFileToken[] = await cache_withFile(
    () => tiktokenizer(texts),
    "./processed/textsTokens.json"
  );

  // Step 3 shorten all texts and save it to a json file (shortenedTexts.json) To contains max 500 tokens by text
  const textsTokensShortened: TextFileToken[] = await cache_withFile(
    () => splitTexts(textTokens),
    "processed/textsTokensShortened.json"
  );

  // let totalToken = 0;
  // textsTokensShortened.forEach((element) => {
  //   totalToken += element.token.length;
  // });

  // console.log("totalToken", totalToken);
  // console.log("textsTokensShortened", textsTokensShortened);

  // Step 4 embed all texts
  const textsEmbeddings: TextFileEmbedding[] = await cache_withFile(
    () => processEmbeddings(textsTokensShortened),
    "processed/textsEmbeddings.json"
  );

  // Step 5 save our embeddings in the database
}

main();

// -----------
// Utils
// -----------

async function cache_withFile<
  T extends (TextFile | TextFileToken | TextFileEmbedding)[]
>(func: () => Promise<T>, filePath: string) {
  try {
    await fs.access(filePath);

    const fileData = await fs.readFile(filePath, "utf-8");
    console.log("🛟 using Cache file");

    const parsedData = JSON.parse(fileData).map((item: any) => {
      if (item.token && Array.isArray(item.token)) {
        return { ...item, token: new Uint32Array(item.token) };
      }
      return item;
    });

    return parsedData;
  } catch {
    const data = await func();
    console.log("🚀 writing cache file");

    const dataToWrite = data.map((item: TextFile | TextFileToken) => {
      if ("token" in item && item.token instanceof Uint32Array) {
        return { ...item, token: Array.from(item.token) };
      }
      return item;
    });

    await fs.writeFile(filePath, JSON.stringify(dataToWrite));

    return data;
  }
}
