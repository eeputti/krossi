// Reads a coach's shared annual-plan workbook and turns it into the same normalized
// group/week/theme rows the bulk setup already reviews and saves atomically.
import readExcelFile from 'read-excel-file/browser';

const HEADER_ALIASES = {
  week: ['vko', 'vk', 'viikko', 'viikkonumero', 'week', 'week number'],
  year: ['vuosi', 'kalenterivuosi', 'year'],
  group: ['ryhma', 'ryhman nimi', 'joukkue', 'group', 'group name'],
  theme: ['teema', 'viikon teema', 'aihe', 'painopiste', 'theme', 'weekly theme'],
  lead: ['tarkennus', 'painotus', 'tavoite', 'kuvaus', 'sisalto', 'lisatieto', 'lead', 'description'],
};

function normalizeText(value) {
  return String(value == null ? '' : value)
    .trim()
    .toLocaleLowerCase('fi-FI')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ');
}

function normalizeHeader(value) {
  return normalizeText(value).replace(/[^a-z0-9]+/g, ' ').trim();
}

function cleanText(value) {
  if (value == null) return '';
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).trim();
}

function isEmptyRow(row) {
  return !(row || []).some((cell) => cleanText(cell));
}

function findColumn(headers, kind) {
  const aliases = HEADER_ALIASES[kind];
  return headers.findIndex((header) => aliases.includes(normalizeHeader(header)));
}

function isoWeekFromDate(date) {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const year = d.getUTCFullYear();
  const first = new Date(Date.UTC(year, 0, 1));
  return { year, week: Math.ceil((((d - first) / 86400000) + 1) / 7) };
}

function dateFromText(value) {
  const text = cleanText(value);
  let match = text.match(/^(\d{1,2})[.\/-](\d{1,2})[.\/-](20\d{2})$/);
  if (match) return new Date(Date.UTC(Number(match[3]), Number(match[2]) - 1, Number(match[1])));
  match = text.match(/^(20\d{2})-(\d{1,2})-(\d{1,2})$/);
  if (match) return new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return null;
}

function parseYear(value) {
  const match = cleanText(value).match(/20\d{2}/);
  return match ? Number(match[0]) : null;
}

function parseWeek(value, explicitYear, fallbackYear) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return isoWeekFromDate(value);
  const parsedDate = dateFromText(value);
  if (parsedDate) return isoWeekFromDate(parsedDate);

  const text = normalizeText(value);
  let week = null;
  let year = parseYear(explicitYear) || null;
  let match = text.match(/(?:vko|vk|viikko|week)\s*(\d{1,2})(?:\D+(20\d{2}))?/);
  if (match) {
    week = Number(match[1]);
    if (!year && match[2]) year = Number(match[2]);
  }
  if (week == null) {
    match = text.match(/^(20\d{2})\s*[-/]\s*(\d{1,2})$/);
    if (match) { year = year || Number(match[1]); week = Number(match[2]); }
  }
  if (week == null && /^\d{1,2}$/.test(text)) week = Number(text);
  year = year || fallbackYear;
  if (!Number.isInteger(year) || year < 2000 || year > 2100 || !Number.isInteger(week) || week < 1 || week > 53) return null;
  return { year, week };
}

function findHeader(data) {
  const limit = Math.min((data || []).length, 20);
  for (let rowIndex = 0; rowIndex < limit; rowIndex += 1) {
    const headers = data[rowIndex] || [];
    const weekIndex = findColumn(headers, 'week');
    if (weekIndex < 0) continue;
    if (headers.filter((cell) => cleanText(cell)).length < 2) continue;
    return {
      rowIndex, headers, weekIndex,
      yearIndex: findColumn(headers, 'year'),
      groupIndex: findColumn(headers, 'group'),
      themeIndex: findColumn(headers, 'theme'),
      leadIndex: findColumn(headers, 'lead'),
    };
  }
  return null;
}

function wideColumn(header) {
  const raw = cleanText(header);
  if (!raw) return null;
  const normalized = normalizeText(raw);
  const suffix = normalized.match(/^(.*?)(?:\s*[-–—/:]\s*|\s+)(teema|theme|tarkennus|painotus|tavoite|kuvaus|sisalto|lead|description)$/);
  if (!suffix) return { groupName: raw, field: 'title' };
  const field = HEADER_ALIASES.lead.includes(normalizeHeader(suffix[2])) ? 'lead' : 'title';
  const groupName = raw.slice(0, suffix[1].length).trim();
  return groupName ? { groupName, field } : null;
}

function addIssue(issues, sheet, row, message) {
  issues.push(`${sheet}, rivi ${row}: ${message}`);
}

function parseLongSheet(sheet, header, fallbackYear, rows, issues) {
  let previousGroup = '';
  let previousYear = fallbackYear;
  for (let index = header.rowIndex + 1; index < sheet.data.length; index += 1) {
    const row = sheet.data[index] || [];
    if (isEmptyRow(row)) continue;
    const groupCell = cleanText(row[header.groupIndex]);
    if (groupCell) previousGroup = groupCell;
    const yearCell = header.yearIndex >= 0 ? parseYear(row[header.yearIndex]) : null;
    if (yearCell) previousYear = yearCell;
    const week = parseWeek(row[header.weekIndex], previousYear, fallbackYear);
    const title = cleanText(row[header.themeIndex]);
    const lead = header.leadIndex >= 0 ? cleanText(row[header.leadIndex]) : '';
    if (!title && !cleanText(row[header.weekIndex])) continue;
    if (!previousGroup) { addIssue(issues, sheet.sheet, index + 1, 'ryhmän nimi puuttuu'); continue; }
    if (!week) { addIssue(issues, sheet.sheet, index + 1, 'viikkoa ei tunnistettu'); continue; }
    if (!title) continue;
    rows.push({ groupName: previousGroup, ...week, title, lead, sheet: sheet.sheet, sourceRow: index + 1 });
  }
}

function parseGroupSheet(sheet, header, fallbackYear, rows, issues) {
  const groupName = cleanText(sheet.sheet);
  let previousYear = fallbackYear;
  for (let index = header.rowIndex + 1; index < sheet.data.length; index += 1) {
    const row = sheet.data[index] || [];
    if (isEmptyRow(row)) continue;
    const yearCell = header.yearIndex >= 0 ? parseYear(row[header.yearIndex]) : null;
    if (yearCell) previousYear = yearCell;
    const week = parseWeek(row[header.weekIndex], previousYear, fallbackYear);
    const title = cleanText(row[header.themeIndex]);
    const lead = header.leadIndex >= 0 ? cleanText(row[header.leadIndex]) : '';
    if (!title && !cleanText(row[header.weekIndex])) continue;
    if (!week) { addIssue(issues, sheet.sheet, index + 1, 'viikkoa ei tunnistettu'); continue; }
    if (!title) continue;
    rows.push({ groupName, ...week, title, lead, sheet: sheet.sheet, sourceRow: index + 1 });
  }
}

function parseWideSheet(sheet, header, fallbackYear, rows, issues) {
  const columns = [];
  header.headers.forEach((value, columnIndex) => {
    if (columnIndex === header.weekIndex || columnIndex === header.yearIndex) return;
    const parsed = wideColumn(value);
    if (parsed) columns.push({ ...parsed, columnIndex });
  });
  const byGroup = new Map();
  columns.forEach((column) => {
    const key = normalizeText(column.groupName);
    const entry = byGroup.get(key) || { groupName: column.groupName };
    entry[column.field] = column.columnIndex;
    byGroup.set(key, entry);
  });
  let previousYear = fallbackYear;
  for (let index = header.rowIndex + 1; index < sheet.data.length; index += 1) {
    const row = sheet.data[index] || [];
    if (isEmptyRow(row)) continue;
    const yearCell = header.yearIndex >= 0 ? parseYear(row[header.yearIndex]) : null;
    if (yearCell) previousYear = yearCell;
    const week = parseWeek(row[header.weekIndex], previousYear, fallbackYear);
    const hasTheme = [...byGroup.values()].some((group) => group.title != null && cleanText(row[group.title]));
    if (!week && hasTheme) { addIssue(issues, sheet.sheet, index + 1, 'viikkoa ei tunnistettu'); continue; }
    if (!week) continue;
    byGroup.forEach((group) => {
      const title = group.title == null ? '' : cleanText(row[group.title]);
      if (!title) return;
      const lead = group.lead == null ? '' : cleanText(row[group.lead]);
      rows.push({ groupName: group.groupName, ...week, title, lead, sheet: sheet.sheet, sourceRow: index + 1 });
    });
  }
}

function koutsiParseThemeWorkbookData(sheets, { fallbackYear = new Date().getFullYear() } = {}) {
  const rows = [];
  const issues = [];
  const warnings = [];
  (sheets || []).forEach((sheet) => {
    const header = findHeader(sheet.data || []);
    if (!header) {
      if ((sheet.data || []).some((row) => !isEmptyRow(row))) warnings.push(`Välilehti ”${sheet.sheet}” ohitettiin, koska viikkosaraketta ei löytynyt.`);
      return;
    }
    if (header.groupIndex >= 0 && header.themeIndex >= 0) parseLongSheet(sheet, header, fallbackYear, rows, issues);
    else if (header.themeIndex >= 0) parseGroupSheet(sheet, header, fallbackYear, rows, issues);
    else parseWideSheet(sheet, header, fallbackYear, rows, issues);
  });

  const unique = new Map();
  rows.forEach((row) => {
    const key = `${normalizeText(row.groupName)}:${row.year}-${row.week}`;
    if (unique.has(key)) warnings.push(`${row.groupName}, vko ${row.week}/${row.year} esiintyi useasti — viimeinen arvo otettiin käyttöön.`);
    unique.set(key, row);
  });
  return { rows: [...unique.values()], issues, warnings };
}

async function koutsiReadThemeWorkbook(file, options) {
  if (!file || !/\.xlsx$/i.test(file.name || '')) throw new Error('Valitse .xlsx-muotoinen Excel-tiedosto.');
  const sheets = await readExcelFile(file);
  return koutsiParseThemeWorkbookData(sheets, options);
}

Object.assign(window, { koutsiReadThemeWorkbook, koutsiParseThemeWorkbookData });
