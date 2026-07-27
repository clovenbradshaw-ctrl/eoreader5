import { readFileSync } from "fs";
import { entityFold } from "./packages/engine/emergence/summary/entity-fold.js";

const wp = readFileSync("/Users/mlacy/Downloads/pg2600.txt", "utf-8");
const packet = entityFold(wp, "Natasha Rostova", { title: "Natasha Rostova" });
console.log(JSON.stringify(packet, null, 2));
