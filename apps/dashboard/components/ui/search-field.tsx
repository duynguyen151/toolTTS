"use client";

import { MagnifyingGlassIcon, XMarkIcon } from "@heroicons/react/24/outline";
import { useId, useState } from "react";

type SearchFieldProps = {
  defaultValue?: string;
  label: string;
  name: string;
  placeholder?: string;
};

export function SearchField({
  defaultValue = "",
  label,
  name,
  placeholder = "Search...",
}: SearchFieldProps) {
  const id = useId();
  const [value, setValue] = useState(defaultValue);

  return (
    <label className="search-field" htmlFor={id}>
      <span className="sr-only">{label}</span>
      <MagnifyingGlassIcon className="search-field__icon" aria-hidden="true" />
      <input
        id={id}
        aria-label={label}
        name={name}
        type="search"
        value={value}
        placeholder={placeholder}
        onChange={(event) => setValue(event.target.value)}
      />
      {value ? (
        <button
          aria-label={`Clear ${label.toLowerCase()}`}
          className="search-field__clear"
          type="button"
          onClick={() => setValue("")}
        >
          <XMarkIcon aria-hidden="true" />
        </button>
      ) : null}
    </label>
  );
}
