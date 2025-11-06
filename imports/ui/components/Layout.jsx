import React from 'react';
import './styles.css';

export const Layout = ({ children }) => {
  return (
    <div className="layout">
      <header className="header">
        <div className="header-container">
          <div className="header-logo">
            <img src="/hpp-logo.webp" alt="HPP Logo" className="logo-image" />
            <h1 className="header-title">House Party Protocol</h1>
          </div>
          <nav className="header-nav">
            <span className="header-subtitle">
              Analytics Dashboard
            </span>
          </nav>
        </div>
      </header>
      <main className="main-content">
        {children}
      </main>
    </div>
  );
};
