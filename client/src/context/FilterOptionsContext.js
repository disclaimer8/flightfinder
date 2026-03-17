import { createContext, useContext } from 'react';

export const FilterOptionsContext = createContext(null);

export function useFilterOptions() {
  return useContext(FilterOptionsContext);
}
