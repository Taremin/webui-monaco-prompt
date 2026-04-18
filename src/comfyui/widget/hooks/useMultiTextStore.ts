import { useState, useEffect, useMemo } from "preact/hooks";
import type { MultiTextWidget } from "../multitext_widget";
import type { MultiTextData } from "../multitext_widget"; // We will export these types from multitext_widget.ts later

export type DeepReadonly<T> =
    T extends (infer R)[] ? DeepReadonlyArray<R> :
    T extends Function ? T :
    T extends object ? DeepReadonlyObject<T> :
    T;
interface DeepReadonlyArray<T> extends ReadonlyArray<DeepReadonly<T>> {}
type DeepReadonlyObject<T> = {
    readonly [P in keyof T]: DeepReadonly<T[P]>;
};

/**
 * MultiTextWidget の状態を講読（Subscribe）し、変更があればコンポーネントを再描画する。
 * 返り値は DeepReadonly になっており、Component側からの直接変更（setState）は不可能。
 */
export function useMultiTextStore(widget: MultiTextWidget): DeepReadonly<MultiTextData> {
    // 状態のコピー（スナップショット）を保持する。
    // json経由でコピーするか、あるいは直接参照でも良いがReadonlyアクセスのみを担保する。
    const [snapshot, setSnapshot] = useState<MultiTextData>(() => {
        // 初期状態のクローン（念のため）
        return { ...widget.data };
    });

    useEffect(() => {
        // widget 側でデータが更新された（commitDataが呼ばれた等）時に発火するコールバック
        const handleStateChange = (newData: MultiTextData) => {
            setSnapshot({ ...newData });
        };

        const unsubscribe = widget.subscribe(handleStateChange);

        return () => {
            unsubscribe();
        };
    }, [widget]);

    // 型情報としてDeepReadonlyを強制し、ミューテーションによる自己流バグを防ぐ
    return snapshot as DeepReadonly<MultiTextData>;
}
