import React from 'react';
import { Card } from './ui/card';
import { Loader2 } from 'lucide-react';

const SimpleLineChart = ({ data, dataKey, color = '#8b5cf6', title = 'Last 7 days' }) => {
  if (!data || data.length === 0) {
    return (
      <div className="chart-placeholder" style={{ height: '120px', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#666' }}>
        No data yet
      </div>
    );
  }

  // Find min and max for scaling
  const values = data.map(d => d[dataKey] || 0);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;

  // SVG dimensions
  const width = 300;
  const height = 120;
  const padding = { top: 25, right: 15, bottom: 25, left: 40 };

  // Create points for the line
  const chartWidth = width - padding.left - padding.right;
  const chartHeight = height - padding.top - padding.bottom;

  const points = data.map((d, i) => {
    const x = padding.left + (data.length > 1 ? (i / (data.length - 1)) * chartWidth : chartWidth / 2);
    const value = d[dataKey] || 0;
    const y = padding.top + chartHeight - ((value - min) / range) * chartHeight;
    return `${x},${y}`;
  }).join(' ');

  // Format numbers compactly for Y-axis labels (no decimals)
  const formatYAxisLabel = (value) => {
    if (value >= 1000000) {
      return `${(value / 1000000).toFixed(1)}M`;
    } else if (value >= 1000) {
      return `${(value / 1000).toFixed(0)}K`;
    }
    return Math.round(value).toLocaleString();
  };

  return (
    <svg width={width} height={height} style={{ display: 'block' }}>
      {/* Title */}
      <text x={width / 2} y={15} textAnchor="middle" fill="#888" fontSize="11" fontWeight="500">
        {title}
      </text>

      {/* Grid lines */}
      <line x1={padding.left} y1={padding.top} x2={padding.left} y2={height - padding.bottom} stroke="#333" strokeWidth="1" />
      <line x1={padding.left} y1={height - padding.bottom} x2={width - padding.right} y2={height - padding.bottom} stroke="#333" strokeWidth="1" />

      {/* Y-axis labels */}
      <text x={padding.left - 5} y={padding.top + 5} textAnchor="end" fill="#666" fontSize="10">
        {formatYAxisLabel(max)}
      </text>
      <text x={padding.left - 5} y={height - padding.bottom} textAnchor="end" fill="#666" fontSize="10">
        {formatYAxisLabel(min)}
      </text>

      {/* X-axis labels (first and last) */}
      {data.length > 0 && (
        <>
          <text x={padding.left} y={height - 5} textAnchor="start" fill="#666" fontSize="9">
            {data.length === 1 ? '1 day ago' : `${data.length} days ago`}
          </text>
          <text x={width - padding.right} y={height - 5} textAnchor="end" fill="#666" fontSize="9">
            Today
          </text>
        </>
      )}

      {/* Line */}
      <polyline
        points={points}
        fill="none"
        stroke={color}
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />

      {/* Points */}
      {data.map((d, i) => {
        const x = padding.left + (data.length > 1 ? (i / (data.length - 1)) * chartWidth : chartWidth / 2);
        const value = d[dataKey] || 0;
        const y = padding.top + chartHeight - ((value - min) / range) * chartHeight;
        return (
          <circle
            key={i}
            cx={x}
            cy={y}
            r="3"
            fill={color}
          />
        );
      })}
    </svg>
  );
};

export const KpiRow = ({
  title,
  value,
  description,
  icon: Icon,
  isLoading,
  chartData,
  chartDataKey = 'count',
  chartColor = '#8b5cf6',
  chartTitle,
  onClick,
  clickable
}) => {
  return (
    <Card className={`kpi-row ${clickable ? 'clickable' : ''}`} onClick={onClick}>
      <div className="kpi-row-content">
        <div className="kpi-info">
          <div className="kpi-header">
            <div className="kpi-icon-wrapper">
              {isLoading ? <Loader2 className="kpi-icon spinning" /> : <Icon className="kpi-icon" />}
            </div>
            <div>
              <h3 className="kpi-title">{title}</h3>
              <p className="kpi-description">{description}</p>
            </div>
          </div>
          <div className="kpi-value-large">{value}</div>
        </div>
        <div className="kpi-chart">
          <SimpleLineChart data={chartData} dataKey={chartDataKey} color={chartColor} title={chartTitle} />
        </div>
      </div>
    </Card>
  );
};
