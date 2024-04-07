import * as fs from "fs";
import * as readline from "readline";

// Chemin du répertoire contenant les fichiers texte
const directoryPath: string = "./data/nextjs";

// Fonction pour récupérer les statistiques d'un fichier
async function getFileStats(
  filePath: string
): Promise<{ fileName: string; charCount: number; lineCount: number }> {
  let charCount: number = 0;
  let lineCount: number = 0;

  const fileStream: fs.ReadStream = fs.createReadStream(filePath);
  const rl: readline.Interface = readline.createInterface({
    input: fileStream,
    crlfDelay: Infinity,
  });

  for await (const line of rl) {
    charCount += line.length;
    lineCount++;
  }

  return { fileName: filePath, charCount, lineCount };
}

// Fonction pour parcourir tous les fichiers du répertoire et récupérer les statistiques
async function getStatsForFilesInDirectory(
  directoryPath: string
): Promise<{ fileName: string; charCount: number; lineCount: number }[]> {
  const files: string[] = fs.readdirSync(directoryPath);
  const statsPromises: Promise<{
    fileName: string;
    charCount: number;
    lineCount: number;
  }>[] = files.map(async (file) => {
    const filePath: string = `${directoryPath}/${file}`;
    return await getFileStats(filePath);
  });
  return await Promise.all(statsPromises);
}

// Appel de la fonction pour récupérer les statistiques
getStatsForFilesInDirectory(directoryPath)
  .then((stats) => {
    console.log("Statistiques des fichiers textes :");
    let under5000: number = 0;
    let between5000And10000: number = 0;
    let between10000And15000: number = 0;
    let above15000: number = 0;
    let maxCharCount: number = 0;

    stats.forEach((stat) => {
      console.log(`- Fichier : ${stat.fileName}`);
      console.log(`  Nombre de caractères : ${stat.charCount}`);
      console.log(`  Nombre de lignes : ${stat.lineCount}`);

      if (stat.charCount < 5000) {
        under5000++;
      } else if (stat.charCount >= 5000 && stat.charCount < 10000) {
        between5000And10000++;
      } else if (stat.charCount >= 10000 && stat.charCount < 15000) {
        between10000And15000++;
      } else {
        above15000++;
      }

      maxCharCount = Math.max(maxCharCount, stat.charCount);

      console.log("---------------------------");
    });

    console.log(`Nombre de fichiers à moins de 5000 caractères : ${under5000}`);
    console.log(
      `Nombre de fichiers entre 5000 et 10000 caractères : ${between5000And10000}`
    );
    console.log(
      `Nombre de fichiers entre 10000 et 15000 caractères : ${between10000And15000}`
    );
    console.log(
      `Nombre de fichiers à plus de 15000 caractères : ${above15000}`
    );
    console.log(
      `Nombre maximal de caractères parmi tous les fichiers : ${maxCharCount}`
    );
  })
  .catch((err) =>
    console.error("Erreur lors de la récupération des statistiques :", err)
  );
