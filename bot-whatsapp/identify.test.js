import test from "node:test";
import assert from "node:assert/strict";
import { findCustomers } from "./identify.js";

const clientes = [
  { id: "9001", name: "Bar El Ejemplo (ficticio)" },
  { id: "9002", name: "Tienda Ficticia" },
  { id: "9003", name: "Bar El Cruce" },
  { id: "9004", name: "Pepe" },
  { id: "9005", name: "Bar El Cruce Centro" },
  { id: "9006", name: "Mesón Antiguo", active: false },
];
const ids = (q) => findCustomers(clientes, q).map((c) => c.id);

test("encuentra por el nombre comercial, sin tildes ni mayúsculas ni palabras de relleno", () => {
  assert.deepEqual(ids("Bar El Ejemplo"), ["9001"]);
  assert.deepEqual(ids("  BAR EL EJEMPLO (ficticio) "), ["9001"]);
  assert.deepEqual(ids("tienda ficticia"), ["9002"]);
  assert.deepEqual(ids("Soy Tienda Ficticia"), ["9002"]);
});

test("encuentra por el código de cliente", () => {
  assert.deepEqual(ids("9002"), ["9002"]);
  assert.deepEqual(ids("9 0 0 2"), ["9002"]);
});

test("no identifica con palabras sueltas ni con nombres que no encajan", () => {
  assert.deepEqual(ids("bar"), []);
  assert.deepEqual(ids("Bar Inexistente"), []);
  assert.deepEqual(ids("Bar El Ejemplo Paco"), []); // una palabra de más que no está en el nombre
  assert.deepEqual(ids(""), []);
  assert.deepEqual(ids("el"), []);
});

test("un nombre de una sola palabra exige coincidencia exacta", () => {
  assert.deepEqual(ids("Pepe"), ["9004"]);
  assert.deepEqual(ids("Pep"), ["9004"]); // prefijo de al menos 3 letras de la misma palabra
  assert.deepEqual(ids("Pe"), []);
});

test("si varios clientes encajan por igual se devuelven todos (el bot pedirá el código)", () => {
  assert.deepEqual(ids("Bar El Cruce"), ["9003"]); // la coincidencia exacta gana a «Centro»
  assert.deepEqual(ids("Bar Cruce").sort(), ["9003", "9005"]);
});

test("ignora clientes dados de baja", () => {
  assert.deepEqual(ids("Mesón Antiguo"), []);
});

test("también encuentra por la razón social", () => {
  const lista = [{ id: "1", name: "CARNICERIA JESUS", legalName: "JESUS ALONSO ARRIBAS" }, { id: "2", name: "BAR LA PLAZA", legalName: "" }];
  assert.deepEqual(findCustomers(lista, "carniceria jesus").map((c) => c.id), ["1"]);
  assert.deepEqual(findCustomers(lista, "Jesús Alonso Arribas").map((c) => c.id), ["1"]);
  assert.deepEqual(findCustomers(lista, "Jesus Alonso").map((c) => c.id), ["1"]);
  assert.deepEqual(findCustomers(lista, "Jesus").map((c) => c.id), []); // una sola palabra de tres no basta
});

test("la forma jurídica (SL, S.A., CB…) no cuenta: «Tienda Ficticia S.L.» es «Tienda Ficticia»", () => {
  const lista = [{ id: "1", name: "TIENDA FICTICIA", legalName: "TIENDA FICTICIA S.L." }, { id: "2", name: "BAR LA PLAZA CB" }];
  assert.deepEqual(findCustomers(lista, "Tienda Ficticia SL").map((c) => c.id), ["1"]);
  assert.deepEqual(findCustomers(lista, "tienda ficticia s.l.").map((c) => c.id), ["1"]);
  assert.deepEqual(findCustomers(lista, "Bar La Plaza").map((c) => c.id), ["2"]);
  assert.deepEqual(findCustomers(lista, "SL"), []); // solo la forma jurídica no identifica a nadie
});
