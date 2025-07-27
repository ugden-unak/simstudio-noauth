import { useEffect, useState } from 'react'
import { Check, ChevronDown, RefreshCw } from 'lucide-react'
import { LinearIcon } from '@/components/icons'
import { Button } from '@/components/ui/button'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'

export interface LinearTeamInfo {
  id: string
  name: string
}

interface LinearTeamSelectorProps {
  value: string
  onChange: (teamId: string, teamInfo?: LinearTeamInfo) => void
  credential: string
  label?: string
  disabled?: boolean
  showPreview?: boolean
}

export function LinearTeamSelector({
  value,
  onChange,
  credential,
  label = 'Select Linear team',
  disabled = false,
}: LinearTeamSelectorProps) {
  const [teams, setTeams] = useState<LinearTeamInfo[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [open, setOpen] = useState(false)
  const [selectedTeam, setSelectedTeam] = useState<LinearTeamInfo | null>(null)

  useEffect(() => {
    if (!credential) return
    const controller = new AbortController()
    setLoading(true)
    setError(null)

    fetch('/api/tools/linear/teams', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ credential }),
      signal: controller.signal,
    })
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP error! status: ${res.status}`)
        return res.json()
      })
      .then((data) => {
        if (data.error) {
          setError(data.error)
          setTeams([])
        } else {
          setTeams(data.teams)

          // Find selected team info if we have a value
          if (value) {
            const teamInfo = data.teams.find((t: LinearTeamInfo) => t.id === value)
            setSelectedTeam(teamInfo || null)
          }
        }
      })
      .catch((err) => {
        if (err.name === 'AbortError') return
        setError(err.message)
        setTeams([])
      })
      .finally(() => setLoading(false))
    return () => controller.abort()
  }, [credential, value])

  // Sync selected team with value prop
  useEffect(() => {
    if (value && teams.length > 0) {
      const teamInfo = teams.find((t) => t.id === value)
      setSelectedTeam(teamInfo || null)
    } else if (!value) {
      setSelectedTeam(null)
    }
  }, [value, teams])

  const handleSelectTeam = (team: LinearTeamInfo) => {
    setSelectedTeam(team)
    onChange(team.id, team)
    setOpen(false)
  }

  const handleOpenChange = (isOpen: boolean) => {
    setOpen(isOpen)
  }

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <Button
          variant='outline'
          role='combobox'
          aria-expanded={open}
          className='w-full justify-between'
          disabled={disabled || !credential}
        >
          {selectedTeam ? (
            <div className='flex items-center gap-2 overflow-hidden'>
              <LinearIcon className='h-4 w-4' />
              <span className='truncate font-normal'>{selectedTeam.name}</span>
            </div>
          ) : (
            <div className='flex items-center gap-2'>
              <LinearIcon className='h-4 w-4' />
              <span className='text-muted-foreground'>{label}</span>
            </div>
          )}
          <ChevronDown className='ml-2 h-4 w-4 shrink-0 opacity-50' />
        </Button>
      </PopoverTrigger>
      <PopoverContent className='w-[300px] p-0' align='start'>
        <Command>
          <CommandInput placeholder='Search teams...' />
          <CommandList>
            <CommandEmpty>
              {loading ? (
                <div className='flex items-center justify-center p-4'>
                  <RefreshCw className='h-4 w-4 animate-spin' />
                  <span className='ml-2'>Loading teams...</span>
                </div>
              ) : error ? (
                <div className='p-4 text-center'>
                  <p className='text-destructive text-sm'>{error}</p>
                </div>
              ) : !credential ? (
                <div className='p-4 text-center'>
                  <p className='font-medium text-sm'>Missing credentials</p>
                  <p className='text-muted-foreground text-xs'>
                    Please configure Linear credentials.
                  </p>
                </div>
              ) : (
                <div className='p-4 text-center'>
                  <p className='font-medium text-sm'>No teams found</p>
                  <p className='text-muted-foreground text-xs'>
                    No teams available for this Linear account.
                  </p>
                </div>
              )}
            </CommandEmpty>

            {teams.length > 0 && (
              <CommandGroup>
                <div className='px-2 py-1.5 font-medium text-muted-foreground text-xs'>Teams</div>
                {teams.map((team) => (
                  <CommandItem
                    key={team.id}
                    value={`team-${team.id}-${team.name}`}
                    onSelect={() => handleSelectTeam(team)}
                    className='cursor-pointer'
                  >
                    <div className='flex items-center gap-2 overflow-hidden'>
                      <LinearIcon className='h-4 w-4' />
                      <span className='truncate font-normal'>{team.name}</span>
                    </div>
                    {team.id === value && <Check className='ml-auto h-4 w-4' />}
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
