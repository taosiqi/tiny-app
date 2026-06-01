import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import {
  AppButton,
  AppCard,
  AppInput,
  AppPanel,
  AppSelect,
  AppSelectField,
  AppTabs,
  EmptyState,
  StatusPill
} from './base'

describe('base UI components', () => {
  it('renders stable surface and variant classes', () => {
    render(
      <AppPanel>
        <AppCard active>Card</AppCard>
        <AppButton variant="primary">Save</AppButton>
        <StatusPill tone="success">Ready</StatusPill>
        <EmptyState>Empty</EmptyState>
      </AppPanel>
    )

    expect(screen.getByText('Card')).toHaveClass('app-card-active')
    expect(screen.getByRole('button', { name: 'Save' })).toHaveClass('app-button-primary')
    expect(screen.getByText('Ready')).toHaveClass('status-pill-success')
    expect(screen.getByText('Empty')).toHaveClass('empty-state')
  })

  it('supports tab changes and form controls', () => {
    const onChange = vi.fn()
    render(
      <>
        <AppTabs
          items={[
            { id: 'a', label: 'A' },
            { id: 'b', label: 'B' }
          ]}
          value="a"
          onChange={onChange}
        />
        <AppInput aria-label="Name" defaultValue="Tiny" />
        <AppSelect aria-label="Mode" defaultValue="x">
          <option value="x">X</option>
        </AppSelect>
        <AppSelectField label="Format" aria-label="Format" defaultValue="png" error="Required">
          <option value="png">PNG</option>
        </AppSelectField>
      </>
    )

    fireEvent.click(screen.getByRole('button', { name: 'B' }))
    expect(onChange).toHaveBeenCalledWith('b')
    expect(screen.getByLabelText('Name')).toHaveClass('app-input')
    expect(screen.getByLabelText('Mode')).toHaveClass('app-input')
    expect(screen.getByLabelText('Format')).toHaveClass('app-input')
    expect(screen.getByText('Required')).toHaveClass('text-red-500')
  })
})
