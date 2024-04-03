# Nextjs Doc Scraper

### Scrap datas from nextjs doc:

This will scrap the data from nextjs doc and save it in separate files in data/nextjs folder.

```terminal
npm run scrap
```

## Create dataBase for store embedding data:

On Neon.tech créate a database (Neon because is compatible with vector data) and create a collection for store the data.

add the connection string in DATABASE_URL in .env. Be sure to complete userName and replace \*\*\*\*\*\*\* by password

Create Tables with the command SQL in database.sql

```sql
DROP SCHEMA public CASCADE;

CREATE SCHEMA public;

CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS documents (text text, n_tokens integer, file_path text, embeddings vector(1536));

CREATE INDEX ON documents USING ivfflat (embeddings vector_cosine_ops);

CREATE TABLE IF NOT EXISTS openai_ft_data (
  id SERIAL PRIMARY KEY,
  query TEXT NOT NULL,
  answer TEXT NOT NULL,
  suggested_answer TEXT,
  user_feedback BOOLEAN
);

CREATE TABLE IF NOT EXISTS usage (
  id SERIAL PRIMARY KEY,
  ip_address TEXT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);
```

### Commentaires:

```comment
La librairie tikToken permet de transformer du texte en token compréhensible par openAi.
```

[Lien vers npm tiktoken](https://www.npmjs.com/package/@dqbd/tiktoken#nextjs) / [Lien vers le github de tiktoken](https://github.com/dqbd/tiktoken/blob/main/js/README.md)

Add OpenAi key in .env for use the Api for embedding the data.

### Embedding and tokenise datas:

```terminal
 npm run embedding
```

This command will do this actions:

- Create array with texts and fileName and save it to a json file (texts.json)
- tokenized all texts and save it to a json file (textsTokens.json)
