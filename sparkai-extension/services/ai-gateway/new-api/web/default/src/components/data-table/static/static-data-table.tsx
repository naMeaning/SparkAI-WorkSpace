/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program. If not, see <https://www.gnu.org/licenses/>.

For commercial licensing, please contact support@quantumnous.com
*/
import * as React from 'react'

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { cn } from '@/lib/utils'

import { TruncatedCell } from '../core/truncated-cell'
import { staticDataTableClassNames } from './static-data-table-classnames'

type StaticDataTableBaseProps = {
  className?: string
  tableClassName?: string
  mobileCards?: boolean
  mobileCardClassName?: string
  containerProps?: Omit<React.ComponentProps<'div'>, 'className' | 'children'>
  tableProps?: Omit<
    React.ComponentProps<typeof Table>,
    'className' | 'children'
  >
}

type StaticDataTableDataProps<TData = unknown> = StaticDataTableBaseProps & {
  columns: StaticDataTableColumn<TData>[]
  data: TData[]
  getRowKey?: (row: TData, index: number) => React.Key
  getRowClassName?: (row: TData, index: number) => string | undefined
  renderRow?: (row: TData, index: number) => React.ReactNode
  empty?: boolean
  emptyContent?: React.ReactNode
  emptyClassName?: string
  headerRowClassName?: string
}

type StaticDataTableChildrenProps = StaticDataTableBaseProps & {
  children: React.ReactNode
  columns?: never
  data?: never
}

type StaticDataTableProps<TData = unknown> =
  | StaticDataTableDataProps<TData>
  | StaticDataTableChildrenProps

export type StaticDataTableColumn<TData = unknown> = {
  id: string
  header: React.ReactNode
  mobileLabel?: React.ReactNode
  hideOnMobile?: boolean
  mobileFullWidth?: boolean
  className?: string
  cellClassName?: string | ((row: TData, index: number) => string | undefined)
  cell?: (row: TData, index: number) => React.ReactNode
}

export function StaticDataTable<TData = unknown>(
  props: StaticDataTableProps<TData>
) {
  const {
    className,
    tableClassName,
    mobileCards,
    mobileCardClassName,
    containerProps,
    tableProps,
  } = props

  if (props.columns !== undefined && mobileCards) {
    return (
      <div
        className={cn(staticDataTableClassNames.container, className)}
        {...containerProps}
      >
        <StaticDataTableMobileCards
          {...props}
          className={mobileCardClassName}
        />
        <div className='hidden md:block'>
          <Table className={tableClassName} {...tableProps}>
            <StaticDataTableWithColumns {...props} />
          </Table>
        </div>
      </div>
    )
  }

  return (
    <div
      className={cn(staticDataTableClassNames.container, className)}
      {...containerProps}
    >
      <Table className={tableClassName} {...tableProps}>
        {props.columns !== undefined ? (
          <StaticDataTableWithColumns {...props} />
        ) : (
          props.children
        )}
      </Table>
    </div>
  )
}

function StaticDataTableMobileCards<TData>(
  props: StaticDataTableDataProps<TData> & { className?: string }
) {
  const isEmpty = props.empty ?? props.data.length === 0
  const columns = props.columns.filter((column) => !column.hideOnMobile)

  if (isEmpty) {
    return (
      <div className='text-muted-foreground flex min-h-24 items-center justify-center px-4 py-6 text-center text-sm md:hidden'>
        {props.emptyContent}
      </div>
    )
  }

  return (
    <div
      role='list'
      className={cn('divide-y md:hidden', props.className)}
      data-slot='mobile-data-cards'
    >
      {props.data.map((row, index) => (
        <article
          key={props.getRowKey?.(row, index) ?? index}
          role='listitem'
          className={cn(
            'bg-card/30 grid min-w-0 gap-2.5 px-3 py-3',
            props.getRowClassName?.(row, index)
          )}
        >
          {columns.map((column) => (
            <div
              key={column.id}
              className={cn(
                'grid min-w-0 items-start gap-3',
                column.mobileFullWidth
                  ? 'border-border/60 grid-cols-1 border-t pt-2 first:border-t-0 first:pt-0'
                  : 'grid-cols-[minmax(5.5rem,0.75fr)_minmax(0,1.25fr)]'
              )}
            >
              <div className='text-muted-foreground min-w-0 text-xs leading-5 font-medium'>
                {column.mobileLabel ?? column.header}
              </div>
              <div
                className={cn(
                  'min-w-0 break-words text-sm leading-5',
                  column.mobileFullWidth
                    ? 'text-left [&>div]:justify-start'
                    : 'text-right [&>div]:justify-end',
                  getStaticCellClassName(column, row, index)
                )}
              >
                {column.cell?.(row, index)}
              </div>
            </div>
          ))}
        </article>
      ))}
    </div>
  )
}

function StaticDataTableWithColumns<TData>({
  columns,
  data,
  getRowKey,
  getRowClassName,
  renderRow,
  empty,
  emptyContent,
  emptyClassName,
  headerRowClassName,
}: StaticDataTableDataProps<TData>) {
  const isEmpty = empty ?? (data !== undefined && data.length === 0)
  const bodyRows = data.map((row, index) => (
    <StaticDataTableRow
      key={getRowKey?.(row, index) ?? index}
      row={row}
      index={index}
      columns={columns}
      getRowClassName={getRowClassName}
      renderRow={renderRow}
    />
  ))

  return (
    <>
      <TableHeader>
        <TableRow className={headerRowClassName}>
          {columns.map((column) => (
            <TableHead key={column.id} className={column.className}>
              {column.header}
            </TableHead>
          ))}
        </TableRow>
      </TableHeader>
      <TableBody>
        {isEmpty ? (
          <StaticDataTableEmptyRow
            colSpan={columns.length}
            className={emptyClassName}
          >
            {emptyContent}
          </StaticDataTableEmptyRow>
        ) : (
          bodyRows
        )}
      </TableBody>
    </>
  )
}

type StaticDataTableRowProps<TData> = Required<
  Pick<StaticDataTableDataProps<TData>, 'columns'>
> &
  Pick<StaticDataTableDataProps<TData>, 'getRowClassName' | 'renderRow'> & {
    row: TData
    index: number
  }

function StaticDataTableRow<TData>({
  row,
  index,
  columns,
  getRowClassName,
  renderRow,
}: StaticDataTableRowProps<TData>) {
  if (renderRow) {
    return <>{renderRow(row, index)}</>
  }

  return (
    <TableRow className={getRowClassName?.(row, index)}>
      {columns.map((column) => (
        <TableCell
          key={column.id}
          className={cn(
            'max-w-full min-w-0 overflow-hidden',
            getStaticCellClassName(column, row, index)
          )}
        >
          {renderStaticCellContent(column, row, index)}
        </TableCell>
      ))}
    </TableRow>
  )
}

function renderStaticCellContent<TData>(
  column: StaticDataTableColumn<TData>,
  row: TData,
  index: number
) {
  const content = column.cell?.(row, index)
  const textContent = getPrimitiveTextContent(content)

  if (!textContent) return content

  return <TruncatedCell tooltipContent={textContent}>{content}</TruncatedCell>
}

function getPrimitiveTextContent(content: React.ReactNode): string | null {
  if (typeof content === 'string' || typeof content === 'number') {
    return String(content)
  }

  if (
    React.isValidElement<{ children?: React.ReactNode }>(content) &&
    (typeof content.props.children === 'string' ||
      typeof content.props.children === 'number')
  ) {
    return String(content.props.children)
  }

  return null
}

function getStaticCellClassName<TData>(
  column: StaticDataTableColumn<TData>,
  row: TData,
  index: number
) {
  return typeof column.cellClassName === 'function'
    ? column.cellClassName(row, index)
    : column.cellClassName
}

type StaticDataTableEmptyRowProps = {
  colSpan: number
  children: React.ReactNode
  className?: string
}

function StaticDataTableEmptyRow({
  colSpan,
  children,
  className,
}: StaticDataTableEmptyRowProps) {
  return (
    <TableRow>
      <TableCell
        colSpan={colSpan}
        className={cn('h-24 text-center', className)}
      >
        {children}
      </TableCell>
    </TableRow>
  )
}
