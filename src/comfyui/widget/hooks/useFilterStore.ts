import { useState, useEffect } from "preact/hooks";
import type { FilterWidget } from "../filter_widget";
import type { FilterRule } from "../filter_widget";

/**
 * FilterWidget のルールの状態を購読（Subscribe）し、変更検知時にコンポーネントを再描画する。
 */
export function useFilterStore(widget: FilterWidget): FilterRule[] {
    const [snapshot, setSnapshot] = useState<FilterRule[]>(() => [...widget.rules]);

    useEffect(() => {
        const handleStateChange = (newRules: FilterRule[]) => {
            setSnapshot([...newRules]);
        };

        const unsubscribe = widget.subscribe(handleStateChange);

        return () => {
            unsubscribe();
        };
    }, [widget]);

    return snapshot;
}
