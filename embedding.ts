import { neon } from "@neondatabase/serverless";
import OpenAI from "openai";
import dotEnv from "dotenv";
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

async function main() {
  const FOLDER = "nextjs";

  // 1 récupérer tous les textes avec leurs noms de fichiers (URL, il faudra ajouter hhtps...)

  // 2 tokenized tous les textes

  // 3 shorten tous les textes pour pas qu'ils soient trop grand"

  // embed tous les textes

  // save nos embeddings dans la base de donnée
}
