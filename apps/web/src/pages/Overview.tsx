import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  AnalyticsGrowthPoint,
  AnalyticsOverview,
  getAnalyticsOverview,
  getStoreAnalytics,
  StoreAnalytics,
} from '../api';
import { StatusPill } from './Stores';

const DAY_MS = 24 * 60 * 60 * 1000;

function dateInputValue(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function defaultRange(): { from: string; to: string } {
  const now = new Date();
  return {
    from: dateInputValue(new Date(now.getTime() - 29 * DAY_MS)),
    to: dateInputValue(now),
  };
}

function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function formatPercent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function totalStores(counts: Record<string, number>): number {
  return Object.values(counts).reduce((total, count) => total + count, 0);
}

function GrowthChart({ points }: { points: AnalyticsGrowthPoint[] }) {
  const chart = useMemo(() => {
    const width = 760;
    const height = 220;
    const padding = { top: 18, right: 18, bottom: 32, left: 18 };
    const values = points.map((point) => point.created);
    const max = Math.max(...values, 1);
    const plotWidth = width - padding.left - padding.right;
    const plotHeight = height - padding.top - padding.bottom;
    const coordinates = points.map((point, index) => {
      const x = points.length <= 1
        ? padding.left + plotWidth / 2
        : padding.left + (index / (points.length - 1)) * plotWidth;
      const y = padding.top + plotHeight - (point.created / max) * plotHeight;
      return { ...point, x, y };
    });
    const line = coordinates.map(({ x, y }) => `${x},${y}`).join(' ');
    const area = coordinates.length
      ? `${padding.left},${padding.top + plotHeight} ${line} ${padding.left + plotWidth},${padding.top + plotHeight}`
      : '';
    return { width, height, padding, plotHeight, plotWidth, coordinates, line, area, max };
  }, [points]);

  if (!points.length) return <p className="state-message">No growth data is available for this range.</p>;

  const first = points[0];
  const last = points[points.length - 1];
  return (
    <div className="growth-chart-wrap">
      <svg className="growth-chart" viewBox={`0 0 ${chart.width} ${chart.height}`} role="img" aria-labelledby="growth-chart-title growth-chart-description">
        <title id="growth-chart-title">Stores created during the selected period</title>
        <desc id="growth-chart-description">A line chart showing the number of stores created on each day.</desc>
        {[0, 0.5, 1].map((ratio) => {
          const y = chart.padding.top + chart.plotHeight * ratio;
          const value = Math.round(chart.max * (1 - ratio));
          return <g key={ratio}><line className="chart-gridline" x1={chart.padding.left} x2={chart.width - chart.padding.right} y1={y} y2={y} /><text className="chart-axis-label" x={chart.width - chart.padding.right} y={y - 5} textAnchor="end">{value}</text></g>;
        })}
        <polygon className="chart-area" points={chart.area} />
        <polyline className="chart-line" points={chart.line} />
        {chart.coordinates.map((point) => <circle className="chart-point" cx={point.x} cy={point.y} key={point.date} r="3.5" />)}
        <text className="chart-date-label" x={chart.padding.left} y={chart.height - 8}>{formatDate(first.date)}</text>
        <text className="chart-date-label" x={chart.width - chart.padding.right} y={chart.height - 8} textAnchor="end">{formatDate(last.date)}</text>
      </svg>
    </div>
  );
}

function StoreStatusSummary({ stores }: { stores: Record<string, number> }) {
  const statuses = Object.entries(stores).sort(([left], [right]) => left.localeCompare(right));
  return (
    <section className="panel" aria-labelledby="store-status-title">
      <div className="panel-heading"><div><p className="eyebrow">Inventory</p><h2 id="store-status-title">Store status</h2></div><span className="count-badge">{totalStores(stores)}</span></div>
      <div className="overview-status-list">
        {statuses.map(([status, count]) => <div className="overview-status-row" key={status}><span><StatusPill status={status} /></span><strong>{count}</strong></div>)}
      </div>
    </section>
  );
}

function RangeControls({
  range,
  onChange,
  onSubmit,
  loading,
}: {
  range: { from: string; to: string };
  onChange: (field: 'from' | 'to', value: string) => void;
  onSubmit: () => void;
  loading: boolean;
}) {
  return (
    <form className="analytics-range" onSubmit={(event) => { event.preventDefault(); onSubmit(); }}>
      <div><label htmlFor="analytics-from">From</label><input id="analytics-from" type="date" value={range.from} max={range.to} onChange={(event) => onChange('from', event.target.value)} /></div>
      <div><label htmlFor="analytics-to">To</label><input id="analytics-to" type="date" value={range.to} min={range.from} max={dateInputValue(new Date())} onChange={(event) => onChange('to', event.target.value)} /></div>
      <button className="button button-secondary" type="submit" disabled={loading || !range.from || !range.to}>{loading ? 'Updating...' : 'Apply range'}</button>
    </form>
  );
}

export default function Overview() {
  const [overview, setOverview] = useState<AnalyticsOverview | null>(null);
  const [rangeData, setRangeData] = useState<StoreAnalytics | null>(null);
  const [range, setRange] = useState(defaultRange);
  const [loading, setLoading] = useState(true);
  const [rangeLoading, setRangeLoading] = useState(false);
  const [error, setError] = useState('');

  async function loadOverview() {
    setLoading(true);
    setError('');
    try {
      setOverview(await getAnalyticsOverview());
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to load overview analytics.');
    } finally {
      setLoading(false);
    }
  }

  async function loadRange() {
    setRangeLoading(true);
    setError('');
    try {
      setRangeData(await getStoreAnalytics(range.from, range.to));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to update the growth range.');
    } finally {
      setRangeLoading(false);
    }
  }

  useEffect(() => { void loadOverview(); }, []);

  const stores = overview?.stores || {};
  const storeCount = totalStores(stores);
  const operationSummary = overview?.operations;

  if (loading) return <div className="content-column"><p className="state-message">Loading workspace overview...</p></div>;
  if (error && !overview) return <div className="content-column"><div className="section-heading"><div><p className="eyebrow">Workspace</p><h1>Overview</h1></div><button className="button button-secondary" type="button" onClick={() => void loadOverview()}>Retry</button></div><p className="alert alert-error" role="alert">{error}</p></div>;
  if (!overview) return null;

  return (
    <div className="content-column">
      <div className="section-heading"><div><p className="eyebrow">Workspace</p><h1>Overview</h1><p className="muted">A quick read on your WooCommerce environments and recent activity.</p></div><button className="button button-secondary" type="button" onClick={() => void loadOverview()} disabled={loading}>Refresh</button></div>
      {error && <p className="alert alert-error" role="alert">{error}</p>}
      {storeCount === 0 ? <section className="panel overview-empty"><p className="eyebrow">Your workspace is ready</p><h2>No stores yet</h2><p className="muted">Create your first store to start tracking status and growth here.</p><Link className="button button-primary" to="/stores/new">Create your first store</Link></section> : <>
        <div className="overview-summary-grid">
          <section className="overview-total"><p className="eyebrow">Total stores</p><strong>{storeCount}</strong><span>Across all statuses</span></section>
          <section className="overview-total"><p className="eyebrow">Operation success</p><strong>{formatPercent(operationSummary?.successRate || 0)}</strong><span>{operationSummary?.succeeded || 0} succeeded / {operationSummary?.failed || 0} failed</span></section>
          <section className="overview-total"><p className="eyebrow">Recent activity</p><strong>{operationSummary?.total || 0}</strong><span>Operations recorded</span></section>
        </div>
        <div className="overview-grid"><StoreStatusSummary stores={stores} /><section className="panel" aria-labelledby="operations-title"><div className="panel-heading"><div><p className="eyebrow">Reliability</p><h2 id="operations-title">Operation outcomes</h2></div></div><div className="outcome-bars"><div><span>Succeeded</span><strong>{formatPercent(operationSummary?.successRate || 0)}</strong><div className="outcome-track"><span className="outcome-success" style={{ width: `${(operationSummary?.successRate || 0) * 100}%` }} /></div></div><div><span>Failed</span><strong>{formatPercent(operationSummary?.failureRate || 0)}</strong><div className="outcome-track"><span className="outcome-failure" style={{ width: `${(operationSummary?.failureRate || 0) * 100}%` }} /></div></div></div></section></div>
        <section className="panel" aria-labelledby="growth-title"><div className="panel-heading overview-growth-heading"><div><p className="eyebrow">Growth</p><h2 id="growth-title">Stores created</h2><p className="muted">Track new environments across a selectable date range.</p></div><RangeControls range={range} onChange={(field, value) => setRange((current) => ({ ...current, [field]: value }))} onSubmit={() => void loadRange()} loading={rangeLoading} /></div><GrowthChart points={rangeData?.growth || overview.growth} /></section>
      </>}
    </div>
  );
}
