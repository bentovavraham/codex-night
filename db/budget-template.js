// Default budget template — mirrors the Active Acquisitions budget spreadsheet.
// account_number = QB leaf GL code; drives the budget grid hierarchy.

const PF  = 'professional_fees';
const AF  = 'application_fees';
const CON = 'construction';

const INIT = 'Initial Design, Due Diligence, Site Investigations & Submissions';
const TRAF = 'Traffic Extras';
const WS   = 'Water & Sewer';
const ENV  = 'Environmental Permitting';
const TWN  = 'Township Hearings / Review';
const LEG  = 'Legal';

module.exports = [
  // ── Initial Design, Due Diligence, Site Investigations & Submissions ──────
  { section: PF, sub_group: INIT, account_number: '1720.01', task_name: 'Concept Plans',                                                discipline: 'Engineering',        default_amount:   5_000 },
  { section: PF, sub_group: INIT, account_number: '1720.01', task_name: 'Site Plans',                                                   discipline: 'Engineering',        default_amount:  15_000 },
  { section: PF, sub_group: INIT, account_number: '1710.01', task_name: 'Survey – ALTA & Topographical',                                discipline: 'Surveying',          default_amount:  10_000 },
  { section: PF, sub_group: INIT, account_number: '1710.05', task_name: 'Wetlands LOI',                                                 discipline: 'Environmental',      default_amount:       0 },
  { section: PF, sub_group: INIT, account_number: '1720.10', task_name: 'Traffic Impact Report',                                        discipline: 'Traffic',            default_amount:       0 },
  { section: PF, sub_group: INIT, account_number: '1720.03', task_name: 'Geotechnical Field Testing + Report (Stormwater)',              discipline: 'Geotechnical',       default_amount:       0 },
  { section: PF, sub_group: INIT, account_number: '1720.07', task_name: 'Environmental – Phase I Report',                               discipline: 'Environmental',      default_amount:  20_000 },
  { section: PF, sub_group: INIT, account_number: '1720.07', task_name: 'Environmental – Phase II Report (if required by Phase I)',     discipline: 'Environmental',      default_amount:  25_000 },
  { section: PF, sub_group: INIT, account_number: '1730.07', task_name: 'Sound Study',                                                  discipline: 'Engineering',        default_amount:  12_000 },
  { section: PF, sub_group: INIT, account_number: '1720.08', task_name: 'Fire-Water DD Report (Fire Tank Sizing)',                      discipline: 'Engineering',        default_amount:  10_000 },
  { section: PF, sub_group: INIT, account_number: '1740.01', task_name: 'Gas & Electric Load Study',                                    discipline: 'Engineering',        default_amount:       0 },

  // ── Traffic Extras ────────────────────────────────────────────────────────
  { section: PF, sub_group: TRAF, account_number: '1720.01', task_name: 'SCD Submission, Coordination & Revisions',                     discipline: 'Engineering',        default_amount:  50_000 },
  { section: PF, sub_group: TRAF, account_number: '1720.10', task_name: 'County Submission & Coordination – Site Plan Approval',        discipline: 'Traffic / Engineer', default_amount:  25_000 },
  { section: PF, sub_group: TRAF, account_number: '1760.10', task_name: 'NJDOT Submission & Coordination',                              discipline: 'Traffic / Engineer', default_amount:  25_000 },
  { section: PF, sub_group: TRAF, account_number: '1710.03', task_name: 'Offsite Traffic Plans & Coordination',                         discipline: 'Traffic',            default_amount:  50_000 },
  { section: PF, sub_group: TRAF, account_number: '1720.10', task_name: 'Traffic Intersection Design incl. Signal Design/Re-timing',    discipline: 'Traffic',            default_amount: 250_000 },

  // ── Water & Sewer ─────────────────────────────────────────────────────────
  { section: PF, sub_group: WS,   account_number: '1720.01', task_name: 'Bridge Design/Specs',                                          discipline: 'Engineering',        default_amount:  50_000 },
  { section: PF, sub_group: WS,   account_number: '1720.05', task_name: 'On-Site WWTP Design & Approval',                               discipline: 'Engineering',        default_amount: 300_000 },
  { section: PF, sub_group: WS,   account_number: '1720.01', task_name: "Engineer's Water and Sewer Reports",                           discipline: 'Engineering',        default_amount:   5_000 },
  { section: PF, sub_group: WS,   account_number: '1740.03', task_name: 'Offsite Public Sewer Design',                                  discipline: 'Engineering',        default_amount:  50_000 },
  { section: PF, sub_group: WS,   account_number: '1740.03', task_name: 'Pump Station and Force Main Design (small / E-One)',            discipline: 'Engineering',        default_amount:  20_000 },
  { section: PF, sub_group: WS,   account_number: '1740.03', task_name: 'Pump Station and FM Design (large / regional)',                 discipline: 'Engineering',        default_amount: 100_000 },
  { section: PF, sub_group: WS,   account_number: '1740.03', task_name: 'Local MUA Coordination & Revisions',                           discipline: 'Engineering',        default_amount:  25_000 },
  { section: PF, sub_group: WS,   account_number: '1760.03', task_name: 'Township Site Plan Application / MUA Fees (misc.)',             discipline: 'Fees & Permits',     default_amount:  30_000 },
  { section: PF, sub_group: WS,   account_number: '1760.15', task_name: 'Regional Sewerage Authority Applications & Coordination',      discipline: 'Fees & Permits',     default_amount:  15_000 },
  { section: PF, sub_group: WS,   account_number: '1760.14', task_name: 'BWSE (Water) Application',                                     discipline: 'Fees & Permits',     default_amount:  10_000 },
  { section: PF, sub_group: WS,   account_number: '1760.08', task_name: 'NJDEP TWA Application',                                        discipline: 'Fees & Permits',     default_amount:  15_000 },
  { section: PF, sub_group: WS,   account_number: '1760.08', task_name: 'NJPDES DGW Application',                                       discipline: 'Fees & Permits',     default_amount:   5_000 },
  { section: PF, sub_group: WS,   account_number: '1710.06', task_name: 'NJDEP FHA Submission and Review Comments/Revisions',           discipline: 'Engineering',        default_amount:  75_000 },
  { section: PF, sub_group: WS,   account_number: '1710.05', task_name: 'NJDEP FWW Permitting and LOI + Revisions',                     discipline: 'Engineering',        default_amount:  25_000 },

  // ── Environmental Permitting ──────────────────────────────────────────────
  { section: PF, sub_group: ENV,  account_number: '1730.06', task_name: 'Cultural Resources Study & Respond to SHPO',                   discipline: 'Environmental',      default_amount:  15_000 },
  { section: PF, sub_group: ENV,  account_number: '1730.06', task_name: 'Intensive Level Architectural Survey',                         discipline: 'Environmental',      default_amount:  25_000 },
  { section: PF, sub_group: ENV,  account_number: '1730.06', task_name: 'Archaeological Survey (Phase 1A)',                             discipline: 'Environmental',      default_amount:  30_000 },
  { section: PF, sub_group: ENV,  account_number: '1730.06', task_name: 'Archaeological Survey (Phase 1B)',                             discipline: 'Environmental',      default_amount:  50_000 },
  { section: PF, sub_group: ENV,  account_number: '1730.06', task_name: 'Additional Archaeological / Cultural Studies (TBD)',           discipline: 'Environmental',      default_amount: 100_000 },

  // ── Township Hearings / Review ────────────────────────────────────────────
  { section: PF, sub_group: TWN,  account_number: '1720.01', task_name: 'Continued Hearing Exhibits',                                   discipline: 'Engineering',        default_amount:  50_000 },
  { section: PF, sub_group: TWN,  account_number: '1720.01', task_name: 'Continued Hearings and Meetings / Testimony',                  discipline: 'Engineering',        default_amount: 150_000 },
  { section: PF, sub_group: TWN,  account_number: '1720.01', task_name: 'Misc. Coordination/Meetings',                                  discipline: 'Engineering',        default_amount:  75_000 },
  { section: PF, sub_group: TWN,  account_number: '1720.01', task_name: 'Township Site Plan Resolution Compliance',                     discipline: 'Engineering',        default_amount: 250_000 },
  { section: PF, sub_group: TWN,  account_number: '1720.01', task_name: 'All Site Plan and Report Revisions per Outside Agency Reviews', discipline: 'Engineering',       default_amount: 100_000 },
  { section: PF, sub_group: TWN,  account_number: '1720.07', task_name: 'RAO / Environmental Remediation',                              discipline: 'Environmental',      default_amount:  50_000 },

  // ── Legal ─────────────────────────────────────────────────────────────────
  { section: PF, sub_group: LEG,  account_number: '1750.01', task_name: 'Legal Fees (Land Use)',                                        discipline: 'Legal',              default_amount:  50_000 },
  { section: PF, sub_group: LEG,  account_number: '1860.04', task_name: 'Legal Fees (Transactional/Recording Attorney)',                 discipline: 'Legal',              default_amount:  15_000 },
  { section: PF, sub_group: LEG,  account_number: '1860.02', task_name: 'Legal Fees (Litigation)',                                      discipline: 'Legal',              default_amount:  75_000 },
  { section: PF, sub_group: LEG,  account_number: '1740.07', task_name: 'Gas Application and Coordination',                             discipline: 'Engineering',        default_amount:  10_000 },
  { section: PF, sub_group: LEG,  account_number: '1760.19', task_name: 'Pinelands Submission',                                         discipline: '',                   default_amount:  10_000 },

  // ── Application & Other Fees ──────────────────────────────────────────────
  { section: AF, sub_group: null, account_number: '1760.02', task_name: 'Local MUA Application Fees (Prelim, Tent, Final)',              discipline: 'Fees & Permits',     default_amount:       0 },
  { section: AF, sub_group: null, account_number: '1760.03', task_name: 'Escrow Fees (Township Professionals)',                          discipline: 'Fees & Permits',     default_amount:       0 },
  { section: AF, sub_group: null, account_number: '1760.19', task_name: 'Pinelands Development Credits',                                discipline: '',                   default_amount:       0 },
  { section: AF, sub_group: null, account_number: '1760.05', task_name: 'CAFRA Submission',                                              discipline: '',                   default_amount:  10_000 },
  { section: AF, sub_group: null, account_number: '1760.14', task_name: 'Water Connection Fees',                                         discipline: '',                   default_amount: 300_000 },
  { section: AF, sub_group: null, account_number: '1760.15', task_name: 'Sewer Connection Fees',                                         discipline: 'Engineering',        default_amount: 500_000 },

  // ── Estimated Extraordinary Construction Costs ────────────────────────────
  { section: CON, sub_group: null, account_number: '1720.04', task_name: 'Geotechnical Structural Evaluation',                           discipline: '',                   default_amount:       0 },
  { section: CON, sub_group: null, account_number: '1810',    task_name: 'ROW Dedication',                                               discipline: 'Engineering',        default_amount:  10_000 },
  { section: CON, sub_group: null, account_number: '1720.02', task_name: 'Dam Class/Breach Analysis',                                    discipline: 'Engineering',        default_amount: 100_000 },
  { section: CON, sub_group: null, account_number: '1720.02', task_name: 'Dam/Berm Seepage / Design of Dams',                            discipline: 'Engineering',        default_amount: 150_000 },
  { section: CON, sub_group: null, account_number: '1740.01', task_name: "JCP&L – Reconductoring 3,000' of Wire (refundable)",           discipline: 'Engineering',        default_amount: 300_000 },
  { section: CON, sub_group: null, account_number: '1740.01', task_name: "JCP&L – Rearranging Circuits in Area (refundable)",            discipline: 'Engineering',        default_amount:  25_000 },
  { section: CON, sub_group: null, account_number: '1740.01', task_name: "JCP&L – Transformer, Primary Cable, Switches (refundable)",    discipline: 'Engineering',        default_amount: 800_000 },
  { section: CON, sub_group: null, account_number: '1720.04', task_name: 'Structural Geotechnical Analysis and Report',                  discipline: 'Engineering',        default_amount:  75_000 },
  { section: CON, sub_group: null, account_number: '1740.01', task_name: 'One Line Diagram for Electric Company',                        discipline: 'Engineering',        default_amount:  15_000 },
  { section: CON, sub_group: null, account_number: '1760.15', task_name: 'Sewer Allocation Purchase',                                    discipline: 'Fees & Permits',     default_amount:       0 },
  { section: CON, sub_group: null, account_number: '1720.02', task_name: 'Vapor Barrier Determination',                                  discipline: 'Engineering',        default_amount:  10_000 },
];
