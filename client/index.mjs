import express from "express";
import path from "path";

const app = express();
const __dirname = path.dirname(new URL(import.meta.url).pathname);

app.use(express.static(path.join(__dirname, "public")));

app.listen(3000, () => {
  console.log("Cliente corriendo en http://localhost:3000");
});

