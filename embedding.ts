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

let i = 0;

// -----------
// Step 1
// Create array with texts and fileName
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
      filePath: entry.name.replace(".txt", ""),
      text,
    });
  }

  return files;
}

// -----------
// Step 2
// tokenized all texts
// -----------

type TextFileToken = TextFile & { token: Uint32Array; tokenLength: number };

const tiktokenizer = async (files: TextFile[]): Promise<TextFileToken[]> => {
  const textFileTokens: TextFileToken[] = [];

  for (const file of files) {
    const token: Uint32Array = encoding.encode(file.text);

    textFileTokens.push({
      ...file,
      token: token,
      tokenLength: token.length,
    });
  }

  return textFileTokens;
};

// -----------
// Step 3
// shorten all texts"
// -----------

const MAX_TOKENS = 1500;
const MAX_TOKENS_PER_CHUNK = 3600;

interface TextChunk extends TextFile {
  tokenLength: number;
}
interface TextChunk extends TextFile {
  tokenLength: number;
}

async function splitTextToMany(text: TextFile): Promise<TextChunk[]> {
  const tagRegex = /\[sous-titre\]/g; // Expression régulière pour trouver les balises
  const filePath = text.filePath;

  // Fonction pour découper le texte en morceaux plus petits
  function splitText(text: string): TextChunk[] {
    const chunks: TextChunk[] = [];
    let startIdx = 0;

    // Rechercher les balises [sous-titre] et découper juste avant
    let match;
    while ((match = tagRegex.exec(text)) !== null) {
      const endIdx = match.index;
      const chunkText = text.substring(startIdx, endIdx).trim();
      const chunkTokenLength = encoding.encode(chunkText).length;

      if (chunkTokenLength > 0) {
        chunks.push({
          filePath: filePath,
          text: chunkText,
          tokenLength: chunkTokenLength,
        });
      }

      startIdx = endIdx;
    }

    // Ajouter le dernier morceau
    const lastChunkText = text.substring(startIdx).trim();
    const lastChunkTokenLength = encoding.encode(lastChunkText).length;

    if (lastChunkTokenLength > 0) {
      chunks.push({
        filePath: filePath,
        text: lastChunkText,
        tokenLength: lastChunkTokenLength,
      });
    }

    return chunks;
  }

  // Découper le texte initial en morceaux plus petits
  let chunks: TextChunk[] = splitText(text.text);
  const totalTokenLength = chunks.reduce(
    (acc, chunk) => acc + chunk.tokenLength,
    0
  );

  // Vérifier si le texte initial est inférieur à la limite de tokens globale
  if (totalTokenLength <= MAX_TOKENS) {
    return [
      {
        filePath: filePath,
        text: text.text,
        tokenLength: totalTokenLength,
      },
    ];
  }

  const result: TextChunk[] = [];

  // Boucle pour traiter chaque chunk
  for (const chunk of chunks) {
    // Vérifier si le chunk dépasse la limite de tokens par morceau
    if (chunk.tokenLength > MAX_TOKENS_PER_CHUNK) {
      // Diviser le chunk en deux parties égales
      const middleIndex = Math.floor(chunk.text.length / 2);
      const firstHalfText = chunk.text.substring(0, middleIndex).trim();
      const secondHalfText = chunk.text.substring(middleIndex).trim();
      const firstHalfTokenLength = encoding.encode(firstHalfText).length;
      const secondHalfTokenLength = encoding.encode(secondHalfText).length;

      // Ajouter les deux parties à la liste des résultats
      result.push({
        filePath: chunk.filePath,
        text: firstHalfText,
        tokenLength: firstHalfTokenLength,
      });
      result.push({
        filePath: chunk.filePath,
        text: secondHalfText,
        tokenLength: secondHalfTokenLength,
      });
    } else {
      // Ajouter le chunk tel quel au résultat
      result.push(chunk);
    }
  }

  return result;
}

async function splitTexts(texts: TextFileToken[]): Promise<TextFile[]> {
  const shortened: TextFile[] = [];

  for (const file of texts) {
    if (file.token.length > MAX_TOKENS) {
      const chunks = await splitTextToMany(file);
      shortened.push(...chunks);
    } else {
      shortened.push(file);
    }
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
      model: "text-embedding-3-small",
      input: file.text,
      encoding_format: "float",
    });
    const embeddings = result.data[0].embedding;

    embededs.push({
      ...file,
      embedding: embeddings,
    });

    i += 1;
    console.log(
      "📀 embedding in progress ...",
      file.filePath,
      i,
      " / ",
      texts.length
    );
  }

  console.log("🛟 embeding done");
  return embededs;
}

// -----------
// 5  save our embeddings data in the database
// -----------

async function saveToDatabse(texts: TextFileEmbedding[]) {
  let totalSave = 0;

  for await (const row of texts) {
    let { text, filePath, embedding } = row;

    // for model text-embedding-3-small and ada v2
    const vectorSize = 1536; // size of vector configured in our database.

    // create a vector of 1536/3072 padded with embeddings data and 0
    const vectorPadded = new Array(vectorSize).fill(0);
    vectorPadded.splice(0, embedding.length, ...embedding);

    const tokens = encoding.encode(text);
    const tokensLength = tokens.length;

    const insertQuery = `
      INSERT INTO documents (text, n_tokens, file_path, embeddings) values ($1, $2, $3, $4)
    `;

    await sql(insertQuery, [
      text,
      tokensLength,
      filePath,
      JSON.stringify(vectorPadded),
    ]);

    totalSave++;
    console.log(
      "📌 Saved to database",
      filePath,
      "total saved",
      totalSave,
      " / ",
      texts.length
    );
  }
}

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

  // Display stats optional
  // displayTokenLengthStats(textsTokensShortened);

  // Step 4 embed all texts
  const textsEmbeddings: TextFileEmbedding[] = await cache_withFile(
    () => processEmbeddings(textsTokensShortened),
    "processed/textsEmbeddings.json"
  );

  // Step 5 save our embeddings data in the database
  await saveToDatabse(textsEmbeddings);
}

main();

// -----------
// Utils
// -----------

interface TextObject {
  tokenLength: number;
  filePath: string;
}

function displayTokenLengthStats(objects: TextObject[]): void {
  let under500: number = 0;
  let between500And1000: number = 0;
  let between1000And1500: number = 0;
  let between1500And2000: number = 0;
  let between2000And2500: number = 0;
  let between2500And3700: number = 0;
  let above3700: number = 0;
  let maxToken: number = 0;

  let tokenstotal = 0;
  objects.forEach((t) => (tokenstotal += t.tokenLength));
  console.log("total tokens", tokenstotal);

  objects.forEach((obj) => {
    const tokenLength = obj.tokenLength;
    if (tokenLength > maxToken) {
      maxToken = tokenLength;
    }

    if (tokenLength < 500) {
      under500++;
    } else if (tokenLength >= 500 && tokenLength < 1000) {
      between500And1000++;
    } else if (tokenLength >= 1000 && tokenLength < 1500) {
      between1000And1500++;
    } else if (tokenLength >= 1500 && tokenLength < 2000) {
      between1500And2000++;
    } else if (tokenLength >= 2000 && tokenLength < 2500) {
      between2000And2500++;
    } else if (tokenLength >= 2500 && tokenLength < 3700) {
      between2500And3700++;
    } else {
      console.log(obj.filePath, tokenLength);
      above3700++;
    }
  });

  console.log("Statistiques sur le nombre de tokens par objet :");
  console.log(`- Nombre d'objets avec moins de 500 tokens : ${under500}`);
  console.log(
    `- Nombre d'objets avec 500 à 1000 tokens : ${between500And1000}`
  );
  console.log(
    `- Nombre d'objets avec 1000 à 1500 tokens : ${between1000And1500}`
  );
  console.log(
    `- Nombre d'objets avec 1500 à 2000 tokens : ${between1500And2000}`
  );
  console.log(
    `- Nombre d'objets avec 2000 à 2500 tokens : ${between2000And2500}`
  );
  console.log(
    `- Nombre d'objets avec 2500 à 3700 tokens : ${between2500And3700}`
  );
  console.log(`- Nombre d'objets avec plus de 3700 tokens : ${above3700}`);
  console.log(`- Nombre maximal de tokens : ${maxToken}`);
}

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
