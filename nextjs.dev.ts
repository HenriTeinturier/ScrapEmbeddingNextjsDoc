import { chromium } from "playwright";
import fs from "fs/promises";
import * as cheerio from "cheerio";

const run = async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto("https://nextjs.org/docs");

  //get the nav element
  const nav = await page.$("nav.styled-scrollbar");

  if (!nav) {
    throw new Error("nav element not found");
  }

  //get all the 'a' elements
  const links = await nav.$$("a");

  const urls = await Promise.all(
    links.map(async (link) => {
      return await link.getAttribute("href");
    })
  );

  const wrapTextWithHtmlTags = (html: string) => {
    const $ = cheerio.load(html);

    $("h1").each((i, el) => {
      const text = $(el).text();
      $(el).text(`[titre principal]${text}[/titre principal]`);
    });

    $("h2").each((i, el) => {
      const text = $(el).text();
      $(el).text(`[sous-titre]${text}[/sous-titre]`);
    });
    $("p").each((i, el) => {
      const text = $(el).text();
      $(el).text(`[paragraphe]${text}[/paragraphe]`);
    });
    $("a").each((i, el) => {
      const text = $(el).text();
      const href = $(el).attr("href");
      $(el).replaceWith(`[lien href="${href}"]${text}[/lien]`);
    });
    $("table").each((i, el) => {
      const text = $(el).text();
      $(el).text(`[tableau]${text}[/tableau]`);
    });
    $("code").each((i, el) => {
      const text = $(el).text();
      $(el).text(`[code]${text}[/code]`);
    });
    $("img").each((i, el) => {
      const altText = $(el).attr("alt") || "Image sans texte alternatif";
      $(el).replaceWith(`[image]${altText}[/image]`);
    });

    const text = $.text();

    return text;
  };

  let totalSave = 0;
  for (const url of urls) {
    totalSave++;
    if (!url) {
      continue;
    }

    console.log("👀 visiting url:", url);
    await page.goto(`https://nextjs.org/${url}`);

    const html = await page.$eval(
      "div.prose.prose-vercel",
      (el) => el.innerHTML
    );

    if (!html) {
      continue;
    }

    const text = wrapTextWithHtmlTags(html);

    const cleanedText = text
      .split("\n")
      .filter((line) => line.trim().length > 0)
      .join("\n");
    const fileName =
      url.replace(/^https?:\/\//, "").replace(/[^a-z0-9\-]/gi, "_") + ".txt";
    const filePath = `./data/nextjs/${fileName}`;
    console.log("🚀 Save " + filePath + " " + totalSave + "/" + urls.length);

    fs.writeFile(filePath, cleanedText, "utf8");
  }
  console.log("end");
  await browser.close();
};

run();
