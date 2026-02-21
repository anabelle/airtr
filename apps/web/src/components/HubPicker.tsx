import { useState, useEffect, useMemo, useRef, useTransition } from 'react';
import { createPortal } from 'react-dom';
import type { Airport } from '@airtr/core';
import { airports as AIRPORTS } from '@airtr/data';
import { useVirtualizer } from '@tanstack/react-virtual';

export function HubPicker({
    currentHub,
    onSelect,
}: {
    currentHub: Airport;
    onSelect: (airport: Airport | null) => void;
}) {
    const [open, setOpen] = useState(false);
    const [search, setSearch] = useState('');
    const [deferredSearch, setDeferredSearch] = useState('');
    const [isPending, startTransition] = useTransition();
    const inputRef = useRef<HTMLInputElement>(null);
    const scrollRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (open && inputRef.current) inputRef.current.focus();
    }, [open]);

    const filtered = useMemo(() => {
        if (!deferredSearch) return AIRPORTS;
        const q = deferredSearch.toLowerCase();
        return AIRPORTS.filter(
            a =>
                a.iata.toLowerCase().includes(q) ||
                a.city.toLowerCase().includes(q) ||
                a.name.toLowerCase().includes(q) ||
                a.country.toLowerCase().includes(q),
        );
    }, [deferredSearch]);

    const virtualizer = useVirtualizer({
        count: filtered.length,
        getScrollElement: () => scrollRef.current,
        estimateSize: () => 64, // approximate height of an item
        overscan: 5,
    });

    const handleSearchChange = (val: string) => {
        setSearch(val);
        startTransition(() => {
            setDeferredSearch(val);
        });
    };

    if (!open) {
        return (
            <button
                className="hub-change-btn"
                onClick={() => setOpen(true)}
                title="Change your hub airport"
                id="hub-change-btn"
            >
                Change hub
            </button>
        );
    }

    return (
        <>
            <button
                className="hub-change-btn"
                onClick={() => setOpen(true)}
                title="Change your hub airport"
                id="hub-change-btn"
            >
                Change hub
            </button>
            {createPortal(
                <div className="hub-picker-overlay">
                    <button
                        className="hub-picker-overlay-bg"
                        onClick={() => setOpen(false)}
                        aria-label="Close hub picker background"
                        tabIndex={-1}
                    />
                    <div className="hub-picker" role="dialog" aria-modal="true">
                        <div className="hub-picker-header">
                            <h2>Choose Your Hub Airport</h2>
                            <button
                                className="hub-picker-close"
                                onClick={() => setOpen(false)}
                                aria-label="Close hub picker"
                            >
                                ✕
                            </button>
                        </div>
                        <label className="sr-only" htmlFor="hub-search-input">Search for a hub</label>
                        <input
                            ref={inputRef}
                            className="hub-picker-search"
                            type="text"
                            name="hub-search"
                            autoComplete="off"
                            spellCheck={false}
                            placeholder="Search by city, IATA code, or airport name…"
                            value={search}
                            onChange={e => handleSearchChange(e.target.value)}
                            id="hub-search-input"
                        />
                        <div
                            className="hub-picker-list"
                            ref={scrollRef}
                            style={{ overflowY: 'auto' }}
                        >
                            <div
                                style={{
                                    height: `${virtualizer.getTotalSize()}px`,
                                    width: '100%',
                                    position: 'relative',
                                }}
                            >
                                {virtualizer.getVirtualItems().map((virtualRow) => {
                                    const airport = filtered[virtualRow.index];
                                    return (
                                        <button
                                            key={airport.iata}
                                            className={`hub-picker-item ${airport.iata === currentHub.iata ? 'active' : ''}`}
                                            style={{
                                                position: 'absolute',
                                                top: 0,
                                                left: 0,
                                                width: '100%',
                                                height: `${virtualRow.size}px`,
                                                transform: `translateY(${virtualRow.start}px)`,
                                            }}
                                            onClick={() => {
                                                onSelect(airport);
                                                setOpen(false);
                                                setSearch('');
                                                setDeferredSearch('');
                                            }}
                                            id={`hub-pick-${airport.iata}`}
                                        >
                                            <span className="hub-picker-iata">{airport.iata}</span>
                                            <span className="hub-picker-info">
                                                <span className="hub-picker-city">{airport.city}</span>
                                                <span className="hub-picker-name">{airport.name}</span>
                                            </span>
                                            <span className="hub-picker-country">{airport.country}</span>
                                        </button>
                                    );
                                })}
                            </div>
                            {filtered.length === 0 && !isPending && (
                                <div className="hub-picker-empty">No airports match “{search}”</div>
                            )}
                            {isPending && (
                                <div className="hub-picker-empty">Searching…</div>
                            )}
                        </div>
                    </div>
                </div>,
                document.body,
            )}
        </>
    );
}
