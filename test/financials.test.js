'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { createInvoice, _test } = require('../lib/financials');

function makeClient(handler) {
  return {
    queries: [],
    async query(sql, params = []) {
      this.queries.push({ sql, params });
      return handler(sql, params);
    },
  };
}

test('money validation rejects more than two decimal places', () => {
  assert.throws(
    () => _test.parseMoney('10.123', 'amount', { required: true }),
    /amount cannot have more than 2 decimal places/
  );
});

test('date validation rejects impossible calendar dates', () => {
  assert.throws(
    () => _test.parseDate('2026-02-30', 'invoice_date'),
    /invoice_date must be a real calendar date/
  );
});

test('allocation target rejects a task from another phase', async () => {
  const client = makeClient(async () => ({
    rows: [{ id: 55, phase_id: 999, qb_account_id: 10 }],
  }));

  await assert.rejects(
    () => _test.resolveAllocationTarget(client, 1, 10, 55, 'invoice line 1'),
    /invoice line 1: budget task does not belong to this phase/
  );
});

test('allocation target rejects a GL that does not match the selected task', async () => {
  const client = makeClient(async () => ({
    rows: [{ id: 55, phase_id: 1, qb_account_id: 10 }],
  }));

  await assert.rejects(
    () => _test.resolveAllocationTarget(client, 1, 20, 55, 'contract line 1'),
    /contract line 1: GL account does not match selected budget task/
  );
});

test('invoice creation rejects header total that differs from line total before insert', async () => {
  const client = makeClient(async () => {
    throw new Error('query should not run before total validation');
  });

  await assert.rejects(
    () => createInvoice(client, {
      project_id: 1,
      phase_id: 2,
      vendor_name: 'Vendor',
      invoice_number: 'INV-100',
      amount: '125.00',
      invoice_date: '2026-05-12',
      line_items: [
        { description: 'Line A', amount: '50.00', qb_account_id: 10, phase_budget_line_id: 100 },
        { description: 'Line B', amount: '50.00', qb_account_id: 10, phase_budget_line_id: 100 },
      ],
    }, 7),
    /invoice amount \(125.00\) must equal line item total \(100.00\)/
  );
  assert.equal(client.queries.length, 0);
});
