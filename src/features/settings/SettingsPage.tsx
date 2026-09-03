import { Link, Outlet, useLocation } from 'react-router'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { PageHeader } from '@/console/components'

const SETTINGS_TABS = [
  { value: 'projects', label: 'Projects', to: '/settings/projects' },
  { value: 'providers', label: 'Providers', to: '/settings/providers' },
  { value: 'mcp', label: 'MCP', to: '/settings/mcp' },
] as const

function currentTab(pathname: string) {
  if (pathname.startsWith('/settings/projects')) {
    return 'projects'
  }
  if (pathname.startsWith('/settings/mcp')) {
    return 'mcp'
  }
  return 'providers'
}

export function SettingsPage() {
  const location = useLocation()

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Settings" description="Review project-level configuration and operational defaults." />
      <Tabs value={currentTab(location.pathname)} className="w-full">
        <TabsList>
          {SETTINGS_TABS.map((tab) => (
            <TabsTrigger key={tab.value} value={tab.value} asChild>
              <Link to={tab.to}>{tab.label}</Link>
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>
      <Outlet />
    </div>
  )
}
