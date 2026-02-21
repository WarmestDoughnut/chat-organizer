import React, { useState } from 'react';
import { OutlinePanel } from './OutlinePanel';

export function Sidebar() {
  const [collapsed, setCollapsed] = useState(false);

  return (
    <div className={`sidebar ${collapsed ? 'sidebar--collapsed' : ''}`}>
      <div className="sidebar__header">
        <span className="sidebar__title">Chat Outline</span>
        <button
          className="sidebar__toggle"
          onClick={() => setCollapsed((c) => !c)}
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          {collapsed ? '◀' : '▶'}
        </button>
      </div>
      {!collapsed && (
        <div className="sidebar__body">
          <OutlinePanel />
        </div>
      )}
    </div>
  );
}
