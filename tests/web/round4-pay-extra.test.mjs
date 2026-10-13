import assert from 'node:assert/strict';
import { test } from 'node:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { installFakeDom } from './helpers/fake-dom.mjs';

const dom = installFakeDom();
document.dispatchEvent = (e) => {
  for (const fn of document.listeners.get(e.type) || []) fn(e);
  return true;
};

const response = (data) => ({
  ok: true,
  status: 200,
  json: async () => ({ success: true, data }),
});
const tick = () =>
  act(async () => {
    await new Promise((r) => setTimeout(r, 5));
  });

const { PayrollScreen } = await import(
  '../../dist/apps/web/src/screens/PayrollScreen.js'
);

test('Mounted PAY Round4: unresolved employee A survives operation B', async () => {
  const sent = [];
  const item = {
    id: 'pay1',
    employee_id: 'emp1',
    employee_code: 'QA01',
    full_name: 'Synthetic Staff',
    hourly_rate_vnd: 40000,
    total_hours: 160,
    gross_pay_vnd: 6400000,
    net_pay_vnd: 6400000,
    confirmed: { net_pay_vnd: 6400000, paid_amount_vnd: 0 },
    work_shifts: [],
    adjustments: [],
    paid_leaves: [],
  };
  globalThis.fetch = async (url, opts = {}) => {
    if (url.includes('/adjustments')) {
      sent.push({ key: opts.headers['Idempotency-Key'], body: opts.body });
      throw new Error('Synthetic lost response after server commit');
    }
    if (url.includes('/auth/me'))
      return response({
        csrf_token: 'synthetic-csrf',
        user: { id: 'u1' },
        active_workspace: { id: 'w1', role: 'owner' },
      });
    if (url.includes('/payroll/periods'))
      return response({
        period: { id: 'p1', month: '2026-10', status: 'draft', version: 1 },
        items: [item, {...item,id:'pay2',employee_id:'emp2',full_name:'Synthetic B'}],
      });
    return response({ items: [] });
  };
  const c = dom.container(),
    root = createRoot(c),
    byId = (id) => dom.find(c, (n) => dom.props(n)['data-testid'] === id)[0];
  try {
    await act(async () =>
      root.render(
        React.createElement(PayrollScreen, {
          role: 'owner',
          onNavigate: () => {},
        }),
      ),
    );
    await tick();
    await act(async () => dom.props(byId('btn-add-adjustment-emp1')).onClick());
    await act(async () =>
      dom.props(byId('adjustment-reason-input')).onChange({
        target: { value: 'Synthetic paid leave' },
      }),
    );
    await act(async () => dom.props(byId('adjustment-submit-btn')).onClick());
    await act(async () => dom.props(byId('adjustment-cancel-btn')).onClick());
    await act(async () => dom.props(byId('btn-add-adjustment-emp2')).onClick());
    await act(async () => dom.props(byId('adjustment-reason-input')).onChange({target:{value:'Synthetic B leave'}}));
    await act(async () => dom.props(byId('adjustment-submit-btn')).onClick());
    await act(async () => dom.props(byId('adjustment-cancel-btn')).onClick());
    await act(async () => dom.props(byId('btn-add-adjustment-emp1')).onClick());
    await act(async () =>
      dom.props(byId('adjustment-reason-input')).onChange({
        target: { value: 'Synthetic paid leave' },
      }),
    );
    await act(async () => dom.props(byId('adjustment-submit-btn')).onClick());
    assert.equal(sent.length, 3);
    assert.equal(sent[0].body, sent[2].body);
    assert.equal(
      sent[0].key,
      sent[2].key,
      'Same pending logical operation must reuse key',
    );
  } finally {
    await act(async () => root.unmount());
  }
});
