// Real QuickBooks chart of accounts for Active Acquisitions LLC.
// Source: chart provided by Calev on 2026-04-15.
//
// Each row is [code, hierarchy_path]. Hierarchy is colon-separated; the last
// segment is the node's name, and the parent is the row whose hierarchy
// matches everything before the last ":".

const REAL_QB_CODES = [
  ['1600', 'Land'],
  ['1610', 'Land:Com Land'],
  ['1612', 'Land:Com Land:Com Land Deposits'],
  ['1614', 'Land:Com Land:Com Contract Payments Applicable'],
  ['1616', 'Land:Com Land:Com Contract Payments Non Applicable'],
  ['1618', 'Land:Com Land:Com Land Purchase'],
  ['1619', 'Land:Com Land:Com Easements/Row/Offsite'],
  ['1620', 'Land:Com Land:Com Forman Farms Option'],
  ['1630', 'Land:Resi Land'],
  ['1632', 'Land:Resi Land:Resi Land Deposits'],
  ['1634', 'Land:Resi Land:Resi Contract Payments Applicable'],
  ['1636', 'Land:Resi Land:Resi Contract Payments Non Applicable'],
  ['1638', 'Land:Resi Land:Resi Land Purchase'],
  ['1639', 'Land:Resi Land:Resi Easements/Row/Offsite'],
  ['1700', 'Entitlement'],
  ['1705', 'Entitlement:Architecture'],
  ['1705.02', 'Entitlement:Architecture:Architectural Design'],
  ['1705.04', 'Entitlement:Architecture:Board Submissions'],
  ['1710', 'Entitlement:Survey'],
  ['1710.01', 'Entitlement:Survey:Boundary/ALTA Survey'],
  ['1710.02', 'Entitlement:Survey:Topographic'],
  ['1710.03', 'Entitlement:Survey:Off-Site Roadway'],
  ['1710.04', 'Entitlement:Survey:Environmental Brownfields'],
  ['1710.05', 'Entitlement:Survey:Ecological/FWW'],
  ['1710.06', 'Entitlement:Survey:Stream/FHA'],
  ['1720', 'Entitlement:Engineering'],
  ['1720.01', 'Entitlement:Engineering:Civil & Landscape Engineering'],
  ['1720.02', 'Entitlement:Engineering:Geotech'],
  ['1720.03', 'Entitlement:Engineering:Geotech-Stormwater'],
  ['1720.04', 'Entitlement:Engineering:Geotech-Structural'],
  ['1720.05', 'Entitlement:Engineering:Geotech-WWTP'],
  ['1720.07', 'Entitlement:Engineering:Environmental & LSRP'],
  ['1720.08', 'Entitlement:Engineering:Fire Suppression'],
  ['1720.09', 'Entitlement:Engineering:Ecological'],
  ['1720.10', 'Entitlement:Engineering:Traffic'],
  ['1720.11', 'Entitlement:Engineering:Railroad'],
  ['1730', 'Entitlement:Consulting Fees'],
  ['1730.01', 'Entitlement:Consulting Fees:Appraisal'],
  ['1730.02', 'Entitlement:Consulting Fees:Planning'],
  ['1730.03', 'Entitlement:Consulting Fees:Public Relations'],
  ['1730.04', 'Entitlement:Consulting Fees:Political Consulting'],
  ['1730.05', 'Entitlement:Consulting Fees:Fiscal'],
  ['1730.06', 'Entitlement:Consulting Fees:Cultural Resources'],
  ['1730.07', 'Entitlement:Consulting Fees:Acoustical'],
  ['1740', 'Entitlement:Utility Design'],
  ['1740.01', 'Entitlement:Utility Design:Electrical-Design'],
  ['1740.02', 'Entitlement:Utility Design:Public Water-Design'],
  ['1740.03', 'Entitlement:Utility Design:Public Sewer-Design'],
  ['1740.05', 'Entitlement:Utility Design:Data-Design'],
  ['1740.07', 'Entitlement:Utility Design:Gas-Design'],
  ['1750', 'Entitlement:Legal Entitlement'],
  ['1750.01', 'Entitlement:Legal Entitlement:Land Use Legal'],
  ['1750.04', 'Entitlement:Legal Entitlement:Environmental Legal'],
  ['1750.06', 'Entitlement:Legal Entitlement:Ecological Legal'],
  ['1760', 'Entitlement:Permits & Fees'],
  ['1760.01', 'Entitlement:Permits & Fees:County'],
  ['1760.02', 'Entitlement:Permits & Fees:Municipal'],
  ['1760.03', 'Entitlement:Permits & Fees:Township Planning Board and Escrow'],
  ['1760.05', 'Entitlement:Permits & Fees:State'],
  ['1760.06', 'Entitlement:Permits & Fees:Bonding-Permits & Fees'],
  ['1760.08', 'Entitlement:Permits & Fees:NJDEP'],
  ['1760.10', 'Entitlement:Permits & Fees:NJDOT'],
  ['1760.12', 'Entitlement:Permits & Fees:Electric- Permits & Fees'],
  ['1760.13', 'Entitlement:Permits & Fees:Gas-Permits & Fees'],
  ['1760.14', 'Entitlement:Permits & Fees:Water-Permits & Fees'],
  ['1760.15', 'Entitlement:Permits & Fees:Sewer - Permits & Fees'],
  ['1760.17', 'Entitlement:Permits & Fees:Soil Conservation Fees'],
  ['1760.18', 'Entitlement:Permits & Fees:COAH'],
  ['1760.19', 'Entitlement:Permits & Fees:Pineland Credits'],
  ['1770', 'Entitlement:Project Management Entitlement'],
  ['1800', 'Construction and Land Development'],
  ['1810', 'Construction and Land Development:Pre-Con Sitework and Land Improvement'],
  ['1820', 'Construction and Land Development:Building Development'],
  ['1820.02', 'Construction and Land Development:Building Development:Construction Design'],
  ['1820.04', 'Construction and Land Development:Building Development:Construction Engineering'],
  ['1820.06', 'Construction and Land Development:Building Development:Construction Fees and Permits'],
  ['1820.08', 'Construction and Land Development:Building Development:Construction Project Management'],
  ['1820.10', 'Construction and Land Development:Building Development:Construction Hard Costs'],
  ['1860', 'Professional Fees'],
  ['1860.01', 'Professional Fees:AA Professional Fees'],
  ['1860.02', 'Professional Fees:Legal Litigation'],
  ['1860.03', 'Professional Fees:Legal Settlement'],
  ['1860.04', 'Professional Fees:Legal Transactional'],
  ['1860.06', 'Professional Fees:Marketing'],
  ['1860.08', 'Professional Fees:Accounting'],
  ['1880', 'General & Administrative'],
  ['1880.02', 'General & Administrative:Insurance'],
  ['1880.04', 'General & Administrative:Real Estate Taxes'],
  ['1880.06', 'General & Administrative:Utilities Usage'],
  ['1880.08', 'General & Administrative:Bank Fees'],
  ['1880.10', 'General & Administrative:Bonding Fees'],
  ['1920', 'Closing Costs'],
  ['1920.02', 'Closing Costs:Broker'],
  ['1920.06', 'Closing Costs:Title'],
  ['1950', 'Finance'],
  ['1950.02', 'Finance:Origination'],
  ['1950.04', 'Finance:Interest'],
  ['1950.08', 'Finance:Financing Cost Misc'],
  ['1999', 'Expenses Capital Cost'],
];

// Insert codes into the database honoring the colon-separated hierarchy.
// Caller provides a pg client (from a transaction).
async function insertRealCodes(client) {
  // idByPath: hierarchy_path -> inserted row id. Parents always inserted first
  // because we sort by depth.
  const rows = REAL_QB_CODES.map(([code, hierarchy]) => {
    const parts = hierarchy.split(':');
    return {
      code,
      hierarchy,
      name: parts[parts.length - 1],
      parent_hierarchy: parts.length > 1 ? parts.slice(0, -1).join(':') : null,
      level: parts.length - 1,
    };
  });
  rows.sort((a, b) => a.level - b.level);

  const idByPath = new Map();
  for (const r of rows) {
    const parentId = r.parent_hierarchy ? idByPath.get(r.parent_hierarchy) : null;
    if (r.parent_hierarchy && !parentId) {
      throw new Error(`Orphan QB code ${r.code}: parent path "${r.parent_hierarchy}" not found`);
    }
    const result = await client.query(
      `INSERT INTO qb_codes (code, name, parent_id, level)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (code) DO UPDATE
         SET name = EXCLUDED.name, parent_id = EXCLUDED.parent_id, level = EXCLUDED.level
       RETURNING id`,
      [r.code, r.name, parentId, r.level]
    );
    idByPath.set(r.hierarchy, result.rows[0].id);
  }
  return rows.length;
}

module.exports = { REAL_QB_CODES, insertRealCodes };
