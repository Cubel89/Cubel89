import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const token = process.env.GITHUB_TOKEN;
const login = process.env.PROFILE_USER || process.env.GITHUB_REPOSITORY_OWNER || 'Cubel89';

if (!token) {
  throw new Error('GITHUB_TOKEN is required');
}

async function graphql(query, variables = {}) {
  const response = await fetch('https://api.github.com/graphql', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      'user-agent': 'profile-readme-stats',
    },
    body: JSON.stringify({ query, variables }),
  });

  const body = await response.json();

  if (!response.ok || body.errors) {
    const details = body.errors ? JSON.stringify(body.errors) : response.statusText;
    throw new Error(`GitHub GraphQL request failed: ${details}`);
  }

  return body.data;
}

function escapeXml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

function formatNumber(value) {
  return new Intl.NumberFormat('en-US').format(value);
}

function roundedScaleMax(maxValue) {
  if (maxValue <= 10) return 10;
  const magnitude = 10 ** Math.floor(Math.log10(maxValue));
  return Math.ceil(maxValue / magnitude) * magnitude;
}

async function fetchContributionYears() {
  const data = await graphql(
    `query($login: String!) {
      user(login: $login) {
        createdAt
        contributionsCollection {
          contributionYears
        }
      }
    }`,
    { login },
  );

  if (!data.user) {
    throw new Error(`GitHub user not found: ${login}`);
  }

  return {
    createdAt: data.user.createdAt,
    years: [...data.user.contributionsCollection.contributionYears].sort((a, b) => a - b),
  };
}

async function fetchAnnualTotals(years) {
  const yearlyFields = years
    .map(
      (year) => `y${year}: contributionsCollection(from: "${year}-01-01T00:00:00Z", to: "${year}-12-31T23:59:59Z") { contributionCalendar { totalContributions } }`,
    )
    .join('\n');

  const data = await graphql(
    `query($login: String!) {
      user(login: $login) {
        ${yearlyFields}
      }
    }`,
    { login },
  );

  return years.map((year) => ({
    year,
    total: data.user[`y${year}`].contributionCalendar.totalContributions,
  }));
}

function buildSvg({ createdAt, totals }) {
  const width = 920;
  const height = 420;
  const plotX = 76;
  const plotY = 120;
  const plotWidth = 790;
  const plotHeight = 205;
  const baseline = plotY + plotHeight;
  const gap = 10;
  const barWidth = (plotWidth - gap * (totals.length - 1)) / totals.length;
  const maxTotal = Math.max(...totals.map((item) => item.total), 1);
  const scaleMax = roundedScaleMax(maxTotal);
  const totalContributions = totals.reduce((sum, item) => sum + item.total, 0);
  const bestYear = totals.reduce((best, item) => (item.total > best.total ? item : best), totals[0]);
  const firstYear = new Date(createdAt).getUTCFullYear();
  const currentYear = new Date().getUTCFullYear();

  const grid = [0.25, 0.5, 0.75, 1]
    .map((ratio) => {
      const y = baseline - plotHeight * ratio;
      const label = Math.round(scaleMax * ratio);
      return `<line x1="${plotX}" y1="${y}" x2="${plotX + plotWidth}" y2="${y}" stroke="#334155" stroke-width="1" stroke-dasharray="4 8" opacity="0.65"/>
<text x="${plotX - 14}" y="${y + 4}" fill="#64748b" font-family="Inter, Segoe UI, Arial, sans-serif" font-size="11" text-anchor="end">${formatNumber(label)}</text>`;
    })
    .join('\n');

  const bars = totals
    .map((item, index) => {
      const x = plotX + index * (barWidth + gap);
      const rawHeight = (item.total / scaleMax) * plotHeight;
      const barHeight = Math.max(rawHeight, item.total > 0 ? 3 : 0);
      const y = baseline - barHeight;
      const highlight = item.year === bestYear.year;
      const fill = highlight ? 'url(#barHighlight)' : 'url(#bar)';
      const valueY = Math.max(plotY + 14, y - 8);
      const yearLabel = item.year === currentYear ? `${item.year}*` : `${item.year}`;

      return `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${barWidth.toFixed(1)}" height="${barHeight.toFixed(1)}" rx="8" fill="${fill}"/>
<text x="${(x + barWidth / 2).toFixed(1)}" y="${valueY.toFixed(1)}" fill="#cbd5e1" font-family="Inter, Segoe UI, Arial, sans-serif" font-size="10" font-weight="700" text-anchor="middle">${formatNumber(item.total)}</text>
<text x="${(x + barWidth / 2).toFixed(1)}" y="${baseline + 24}" fill="#94a3b8" font-family="Inter, Segoe UI, Arial, sans-serif" font-size="11" font-weight="700" text-anchor="middle">${escapeXml(yearLabel)}</text>`;
    })
    .join('\n');

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-labelledby="title desc">
  <title id="title">Contribuciones anuales de GitHub de ${escapeXml(login)}</title>
  <desc id="desc">Grafica de barras con contribuciones anuales desde ${firstYear}.</desc>
  <defs>
    <linearGradient id="card" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#0f172a"/>
      <stop offset="100%" stop-color="#111827"/>
    </linearGradient>
    <linearGradient id="bar" x1="0" y1="1" x2="0" y2="0">
      <stop offset="0%" stop-color="#2563eb"/>
      <stop offset="100%" stop-color="#38bdf8"/>
    </linearGradient>
    <linearGradient id="barHighlight" x1="0" y1="1" x2="0" y2="0">
      <stop offset="0%" stop-color="#7c3aed"/>
      <stop offset="100%" stop-color="#f0abfc"/>
    </linearGradient>
    <filter id="shadow" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="0" dy="18" stdDeviation="22" flood-color="#020617" flood-opacity="0.35"/>
    </filter>
  </defs>
  <rect x="0" y="0" width="${width}" height="${height}" rx="30" fill="url(#card)"/>
  <g filter="url(#shadow)">
    <rect x="24" y="24" width="${width - 48}" height="${height - 48}" rx="26" fill="#020617" opacity="0.24"/>
  </g>

  <text x="44" y="58" fill="#f8fafc" font-family="Inter, Segoe UI, Arial, sans-serif" font-size="28" font-weight="900">Contribuciones anuales</text>
  <text x="44" y="84" fill="#94a3b8" font-family="Inter, Segoe UI, Arial, sans-serif" font-size="14">Cuenta activa desde ${firstYear}. El asterisco marca el periodo en curso.</text>

  <g transform="translate(630 42)">
    <rect x="0" y="0" width="236" height="52" rx="18" fill="#0f172a" opacity="0.86"/>
    <text x="18" y="22" fill="#94a3b8" font-family="Inter, Segoe UI, Arial, sans-serif" font-size="12" font-weight="700">TOTAL</text>
    <text x="18" y="43" fill="#f8fafc" font-family="Inter, Segoe UI, Arial, sans-serif" font-size="22" font-weight="900">${formatNumber(totalContributions)}</text>
    <text x="126" y="22" fill="#94a3b8" font-family="Inter, Segoe UI, Arial, sans-serif" font-size="12" font-weight="700">MEJOR PERIODO</text>
    <text x="126" y="43" fill="#f0abfc" font-family="Inter, Segoe UI, Arial, sans-serif" font-size="22" font-weight="900">${bestYear.year}</text>
  </g>

  <g>
${grid}
    <line x1="${plotX}" y1="${baseline}" x2="${plotX + plotWidth}" y2="${baseline}" stroke="#475569" stroke-width="1.2"/>
${bars}
  </g>

  <text x="${plotX}" y="382" fill="#64748b" font-family="Inter, Segoe UI, Arial, sans-serif" font-size="12">Generado automaticamente desde la API de GitHub.</text>
</svg>
`;
}

const { createdAt, years } = await fetchContributionYears();
const totals = await fetchAnnualTotals(years);
const svg = buildSvg({ createdAt, totals });
const outputPath = path.join(process.cwd(), 'assets', 'contributions-by-year.svg');

await mkdir(path.dirname(outputPath), { recursive: true });
await writeFile(outputPath, svg, 'utf8');

console.log(`Updated ${outputPath} for ${login}`);
