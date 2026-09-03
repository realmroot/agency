import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router'
import { describe, expect, it } from 'vitest'
import { SettingsPage } from './SettingsPage'

describe('SettingsPage', () => {
  it('[spec: web-console/project-management] renders Projects, Providers, and MCP as routed tabs', () => {
    render(
      <MemoryRouter initialEntries={['/settings/projects']}>
        <Routes>
          <Route path="/settings" element={<SettingsPage />}>
            <Route path="projects" element={<div>Projects settings</div>} />
            <Route path="providers" element={<div>Providers settings</div>} />
            <Route path="mcp" element={<div>MCP settings</div>} />
          </Route>
        </Routes>
      </MemoryRouter>,
    )

    expect(screen.getByRole('heading', { name: 'Settings' })).toBeTruthy()
    expect(screen.getByRole('tab', { name: 'Projects' }).getAttribute('href')).toBe('/settings/projects')
    expect(screen.getByRole('tab', { name: 'Providers' }).getAttribute('href')).toBe('/settings/providers')
    expect(screen.getByRole('tab', { name: 'MCP' }).getAttribute('href')).toBe('/settings/mcp')
    expect(screen.getByText('Projects settings')).toBeTruthy()
  })
})
