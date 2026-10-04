import { render, screen } from '@testing-library/react'
import { Plus } from 'lucide-react'
import { describe, expect, it } from 'vitest'

import { Button } from '../button'
import { Table, TableBody, TableCell, TableEmpty, TableHead, TableHeader, TableRow, TableSkeleton } from '../table'

describe('Button', () => {
  it('exposes its size and variant for styling and tests', () => {
    render(
      <Button size="sm" variant="outline">
        Filtrer
      </Button>,
    )
    const button = screen.getByRole('button', { name: 'Filtrer' })
    expect(button).toHaveAttribute('data-size', 'sm')
    expect(button).toHaveAttribute('data-variant', 'outline')
    expect(button.className).toContain('h-8')
  })

  it('maps every documented size to its height', () => {
    const heights = { xs: 'h-7', sm: 'h-8', default: 'h-9', lg: 'h-10', 'icon-xs': 'size-7', 'icon-sm': 'size-8', icon: 'size-9', 'icon-lg': 'size-10' } as const
    for (const [size, cls] of Object.entries(heights)) {
      const { unmount } = render(<Button size={size as keyof typeof heights}>x</Button>)
      expect(screen.getByRole('button').className).toContain(cls)
      unmount()
    }
  })

  it('replaces the leading icon with a spinner and disables itself while loading', () => {
    render(
      <Button loading>
        <Plus data-testid="icon" />
        Créer
      </Button>,
    )
    const button = screen.getByRole('button', { name: 'Créer' })
    expect(button).toBeDisabled()
    expect(button).toHaveAttribute('aria-busy', 'true')
    expect(screen.queryByTestId('icon')).not.toBeInTheDocument()
    expect(button.querySelector('.animate-spin')).not.toBeNull()
  })

  it('renders its child with asChild', () => {
    render(
      <Button asChild>
        <a href="/companies">Mes sociétés</a>
      </Button>,
    )
    expect(screen.getByRole('link', { name: 'Mes sociétés' })).toHaveAttribute('data-slot', 'button')
  })
})

describe('Table', () => {
  it('scrolls inside its own container and right aligns numeric cells', () => {
    render(
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Compte</TableHead>
            <TableHead numeric>Solde</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableRow>
            <TableCell>512000</TableCell>
            <TableCell numeric>1 234,56</TableCell>
          </TableRow>
        </TableBody>
      </Table>,
    )
    const container = screen.getByRole('table').parentElement!
    expect(container).toHaveClass('overflow-x-auto')
    expect(screen.getByRole('columnheader', { name: 'Solde' })).toHaveClass('text-right')
    expect(screen.getByRole('cell', { name: '1 234,56' })).toHaveClass('num', 'text-right')
  })

  it('keeps the header visible with stickyHeader', () => {
    render(
      <Table stickyHeader containerClassName="max-h-96">
        <TableBody />
      </Table>,
    )
    expect(screen.getByRole('table')).toHaveAttribute('data-sticky-header', 'true')
    expect(screen.getByRole('table').parentElement).toHaveClass('max-h-96', 'overflow-y-auto')
  })

  it('renders an empty row across all columns and skeleton rows', () => {
    const { container } = render(
      <Table>
        <TableBody>
          <TableEmpty colSpan={4}>Aucun journal.</TableEmpty>
          <TableSkeleton columns={4} rows={2} />
        </TableBody>
      </Table>,
    )
    expect(screen.getByRole('cell', { name: 'Aucun journal.' })).toHaveAttribute('colspan', '4')
    expect(container.querySelectorAll('[data-slot=table-skeleton]')).toHaveLength(2)
  })
})
