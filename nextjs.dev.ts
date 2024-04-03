import { chromium } from "playwright";
import fs from "fs/promises";

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

  for (const url of urls) {
    console.log("👀 visiting url:", url);
    await page.goto(`https://nextjs.org/${url}`);

    //get the content of the div with .prose.prose-vercel
    const content = await page.$eval(
      "div.prose.prose-vercel",
      (el) => el.textContent
    );

    if (!url) {
      continue;
    }

    if (!content) {
      continue;
    }

    // const completeUrl = `https://nextjs.org${url}`;
    // console.log("completeUrl", completeUrl);

    const encodedUrlForFileName = url.replace(/\//g, "_");
    const filePath = `./data/nextjs/${encodedUrlForFileName}.txt`;
    console.log("🚀 Save " + filePath);
    fs.writeFile(filePath, content);
  }

  await browser.close();
};

run();
