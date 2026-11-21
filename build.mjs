#!/usr/bin/env node
/**
 * build.mjs — Empaqueta la extensión en consulta-boletines-oficiales-v<versión>.mcpb
 *
 * Un .mcpb es un ZIP normal. Este script escribe el ZIP a mano con zlib para
 * no añadir ninguna dependencia al proyecto. Alternativa oficial equivalente:
 *
 *     npx @anthropic-ai/mcpb pack .
 *
 * Uso:  node build.mjs  [salida.mcpb]
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { deflateRawSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const RAIZ = dirname(fileURLToPath(import.meta.url));

/** Ficheros que entran en el paquete, en orden. */
const CONTENIDO = ['manifest.json', 'package.json', 'LICENSE', 'LICENCIA-EUPL-1.2.txt', 'server/nucleo.js', 'server/actualizacion.js', 'server/index.js'];

/* --------------------------- CRC32 --------------------------- */

const TABLA_CRC = (() => {
  const t = new Int32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[i] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = TABLA_CRC[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

/* ------------------------ Fecha en formato DOS ------------------------ */

// Build reproducible (desde la 1.6.1): todas las entradas llevan la misma fecha fija, no la
// hora del build, para que los mismos fuentes den siempre el mismo .mcpb y la misma sha256
// (la que va en server.json). Se puede fijar otra con SOURCE_DATE_EPOCH (segundos, UTC),
// como en otras herramientas de builds reproducibles. Por defecto, 1980-01-01 00:00, la
// primera fecha que admite el formato ZIP.
const FECHA_FIJA = process.env.SOURCE_DATE_EPOCH
  ? new Date(Number(process.env.SOURCE_DATE_EPOCH) * 1000)
  : new Date(Date.UTC(1980, 0, 1, 0, 0, 0));

function fechaDOS(d) {
  return {
    hora: ((d.getUTCHours() << 11) | (d.getUTCMinutes() << 5) | (d.getUTCSeconds() >> 1)) & 0xffff,
    fecha: (((d.getUTCFullYear() - 1980) << 9) | ((d.getUTCMonth() + 1) << 5) | d.getUTCDate()) & 0xffff,
  };
}

/* ------------------------------ ZIP ------------------------------ */

function construirZip(entradas) {
  const locales = [];
  const central = [];
  let offset = 0;
  const { hora, fecha } = fechaDOS(FECHA_FIJA);

  for (const { nombre, datos } of entradas) {
    const nombreBuf = Buffer.from(nombre, 'utf8');
    const comprimido = deflateRawSync(datos, { level: 9 });
    const crc = crc32(datos);

    const cabecera = Buffer.alloc(30);
    cabecera.writeUInt32LE(0x04034b50, 0); // firma
    cabecera.writeUInt16LE(20, 4); // versión necesaria
    cabecera.writeUInt16LE(0x0800, 6); // flags: nombres en UTF-8
    cabecera.writeUInt16LE(8, 8); // método: deflate
    cabecera.writeUInt16LE(hora, 10);
    cabecera.writeUInt16LE(fecha, 12);
    cabecera.writeUInt32LE(crc, 14);
    cabecera.writeUInt32LE(comprimido.length, 18);
    cabecera.writeUInt32LE(datos.length, 22);
    cabecera.writeUInt16LE(nombreBuf.length, 26);
    cabecera.writeUInt16LE(0, 28); // sin campos extra

    locales.push(cabecera, nombreBuf, comprimido);

    const dir = Buffer.alloc(46);
    dir.writeUInt32LE(0x02014b50, 0);
    dir.writeUInt16LE(20, 4); // versión que lo creó
    dir.writeUInt16LE(20, 6); // versión necesaria
    dir.writeUInt16LE(0x0800, 8);
    dir.writeUInt16LE(8, 10);
    dir.writeUInt16LE(hora, 12);
    dir.writeUInt16LE(fecha, 14);
    dir.writeUInt32LE(crc, 16);
    dir.writeUInt32LE(comprimido.length, 20);
    dir.writeUInt32LE(datos.length, 24);
    dir.writeUInt16LE(nombreBuf.length, 28);
    dir.writeUInt32LE(0, 38); // atributos externos
    dir.writeUInt32LE(offset, 42);
    central.push(dir, nombreBuf);

    offset += cabecera.length + nombreBuf.length + comprimido.length;
  }

  const cuerpo = Buffer.concat(locales);
  const directorio = Buffer.concat(central);

  const fin = Buffer.alloc(22);
  fin.writeUInt32LE(0x06054b50, 0);
  fin.writeUInt16LE(entradas.length, 8);
  fin.writeUInt16LE(entradas.length, 10);
  fin.writeUInt32LE(directorio.length, 12);
  fin.writeUInt32LE(cuerpo.length, 16);

  return Buffer.concat([cuerpo, directorio, fin]);
}

/* ---------------------------- Principal ---------------------------- */

const manifiesto = JSON.parse(readFileSync(join(RAIZ, 'manifest.json'), 'utf8'));

// El entry_point declarado tiene que existir de verdad.
if (!CONTENIDO.includes(manifiesto.server.entry_point)) {
  console.error(`ERROR: entry_point "${manifiesto.server.entry_point}" no está en la lista de ficheros a empaquetar.`);
  process.exit(1);
}

const entradas = CONTENIDO.map((nombre) => {
  try {
    return { nombre, datos: readFileSync(join(RAIZ, nombre)) };
  } catch (e) {
    console.error(`ERROR: falta el fichero "${nombre}".`);
    process.exit(1);
  }
});

// El nombre del archivo lleva la versión (consulta-boletines-oficiales-v1.6.1.mcpb) para distinguir builds a simple vista.
// Sin «boe» desde la 1.6.1: el nombre público no puede usar la sigla (consejo jurídico).
const salida = join(RAIZ, process.argv[2] || `consulta-boletines-oficiales-v${manifiesto.version}.mcpb`);
const zip = construirZip(entradas);
writeFileSync(salida, zip);

console.log(manifiesto.display_name);
for (const e of entradas) console.log(`  + ${e.nombre} (${e.datos.length} B)`);
console.log(`\n${salida} — ${(zip.length / 1024).toFixed(1)} KB`);
