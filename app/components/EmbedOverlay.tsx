import {
  Dispatch,
  useMemo,
  useState,
  useCallback,
  useEffect,
  ChangeEvent,
} from 'react';
import { Direction, ServerPuzzleResult } from '../lib/types';
import { PuzzleAction } from '../reducers/reducer';
import { Overlay } from './Overlay';
import { User } from 'firebase/auth';
import { CopyableInput } from './CopyableInput';
import { EmbedOptionsT, validate } from '../lib/embedOptions';
import { colorTheme, LINK, PRIMARY } from '../lib/style';
import { adjustHue, parseToRgba, guard } from 'color2k';
import { GridView } from './Grid';
import { fromCells } from '../lib/viewableGrid';
import { Button, ButtonAsLink } from './Buttons';
import { getDoc, setDoc } from 'firebase/firestore';
import { getDocRef } from '../lib/firebaseWrapper';
import { Global } from '@emotion/react';
import { logAsyncErrors } from '../lib/utils';
import { css } from '@emotion/react';
import type { CSSInterpolation } from '@emotion/serialize';
import { fontFace } from './EmbedStyling';

const fontUrlInputCss = css({
  width: '100%',
  marginBottom: '0.5em',
});

const fontInputLabelCss = css({ display: 'block' });

export const EmbedOverlay = ({
  dispatch,
  puzzle,
  user,
}: {
  puzzle: ServerPuzzleResult;
  dispatch: Dispatch<PuzzleAction>;
  user: User;
}) => {
  const [loadingOptions, setLoadingOptions] = useState(true);
  const [embedOptions, setEmbedOptions] = useState<EmbedOptionsT | null>(null);

  useEffect(() => {
    let didCancel = false;
    async function getEmbedOptions() {
      const res = await getDoc(getDocRef('em', user.uid));
      if (didCancel) {
        return;
      }
      if (!res.exists()) {
        setLoadingOptions(false);
        return;
      }
      const validated = validate(res.data());
      setEmbedOptions(validated);
      setLoadingOptions(false);
    }
    logAsyncErrors(getEmbedOptions)();
    return () => {
      didCancel = true;
    };
  }, [user.uid]);

  return (
    <Overlay
      closeCallback={() => {
        dispatch({ type: 'TOGGLEEMBEDOVERLAY' });
      }}
    >
      <h2>Embed this Puzzle</h2>
      <p>
        To embed your puzzle copy and paste the following HTML into your
        site&apos;s code. You can change the width and height parameters as
        needed, but we recommend giving your puzzle at least 600px of width when
        displaying on desktop (otherwise Crosshare will transition to the mobile
        interface).
      </p>
      <CopyableInput
        text={`<iframe style="height: 90vh; width: 100%;" src="https://crosshare.org/embed/${puzzle.id}/${user.uid}" frameborder="0" allowfullscreen="true" allowtransparency="true" allow="clipboard-write *"></iframe>`}
      />
      <h3 css={{ marginTop: '1em' }}>Theme</h3>
      {loadingOptions ? (
        <p>Loading your embed settings...</p>
      ) : (
        <ThemePicker userId={user.uid} {...embedOptions} />
      )}
      <h3 css={{ marginTop: '1em' }}>Puzzle List</h3>
      <p>
        Alternatively, you can embed a list of your recent public puzzles all at
        once:
      </p>
      <CopyableInput
        text={`<iframe style="height: 90vh; width: 100%;" src="https://crosshare.org/embed/list/${user.uid}" frameborder="0" allowfullscreen="true" allowtransparency="true" allow="clipboard-write *"></iframe>`}
      />
    </Overlay>
  );
};

interface SwatchProps {
  color: string;
  selected: string;
  select: () => void;
}
const Swatch = (props: SwatchProps) => {
  const isSelected = props.color === props.selected;
  return (
    <div
      role="button"
      tabIndex={0}
      css={{
        display: 'inline-block',
        width: isSelected ? '1.5em' : '1em',
        height: isSelected ? '1.5em' : '1em',
        margin: isSelected ? 0 : '0.25em 0.25em',
        borderRadius: '0.25em',
        backgroundColor: props.color,
        cursor: 'pointer',
        '&: hover': {
          width: isSelected ? '1.5em' : '1.25em',
          height: isSelected ? '1.5em' : '1.25em',
          margin: isSelected ? 0 : '0.125em 0.125em',
        },
      }}
      onClick={props.select}
      onKeyPress={props.select}
    />
  );
};

const NUMSWATCHES = 36;

const toHex = (n: number) => guard(0, 255, n).toString(16).padStart(2, '0');
const rgbToHex = (r: number, g: number, b: number) => {
  return '#' + toHex(r) + toHex(g) + toHex(b);
};

interface ColorPickerProps {
  initial: string;
  swatchBase: string;
  onChange: (newColor: string) => void;
}
const ColorPicker = (props: ColorPickerProps) => {
  const [current, setCurrent] = useState(props.initial);
  const [r, g, b] = parseToRgba(props.initial);
  const [hexColor, setHexColor] = useState(rgbToHex(r, g, b));

  const updateHexColor = useCallback(
    (e: ChangeEvent<HTMLInputElement>) => {
      const newColor = e.target.value;
      setHexColor(newColor);
      try {
        const [r, g, b] = parseToRgba(newColor);
        const color = rgbToHex(r, g, b);
        setCurrent(color);
        props.onChange(color);
      } catch {
        /* noop */
      }
    },
    [props]
  );

  const swatches = [];
  for (let i = 0; i < NUMSWATCHES; i += 1) {
    const color = adjustHue(props.swatchBase, (i * 360) / NUMSWATCHES);
    swatches.push(
      <Swatch
        key={i}
        color={color}
        select={() => {
          setCurrent(color);
          props.onChange(color);
          const [r, g, b] = parseToRgba(color);
          setHexColor(rgbToHex(r, g, b));
        }}
        selected={current}
      />
    );
  }

  return (
    <div css={{ marginBottom: '1em' }}>
      {swatches}
      <div>
        <input type="text" value={hexColor} onChange={updateHexColor} />
      </div>
    </div>
  );
};

const ThemePicker = (props: EmbedOptionsT & { userId: string }) => {
  const [isDark, setIsDark] = useState(props.d || false);
  const [primary, setPrimary] = useState(props.p || PRIMARY);
  const [link, setLink] = useState(props.l || LINK);
  const [preservePrimary, setPreservePrimary] = useState(props.pp || false);
  const [dirty, setDirty] = useState(false);
  const [customFontEnabled, setCustomFontEnabled] = useState<boolean>(
    !!props.fu
  );
  const [fontUrl, setFontUrl] = useState(props.fu || '');
  const [fontUrlBold, setFontUrlBold] = useState(props.fub || '');
  const [fontUrlItalic, setFontUrlItalic] = useState(props.fui || '');
  const [fontUrlBoldItalic, setFontUrlBoldItalic] = useState(props.fubi || '');

  const [saving, setSaving] = useState(false);

  const saveTheme = useCallback(() => {
    const theme: EmbedOptionsT = {
      p: primary,
      l: link,
      d: isDark,
      pp: preservePrimary,
      ...(customFontEnabled &&
        fontUrl !== '' && {
          fu: fontUrl,
          ...(fontUrlBold && { fub: fontUrlBold }),
          ...(fontUrlItalic && { fui: fontUrlItalic }),
          ...(fontUrlBoldItalic && { fubi: fontUrlBoldItalic }),
        }),
      ...(props.slate && { slate: true }),
    };
    setSaving(true);
    setDoc(getDocRef('em', props.userId), theme)
      .then(() => {
        setSaving(false);
        setDirty(false);
      })
      .catch((e) => {
        console.log('error updating embed prefs', e);
      });
  }, [
    isDark,
    primary,
    link,
    preservePrimary,
    props.userId,
    props.slate,
    fontUrl,
    fontUrlBold,
    fontUrlItalic,
    fontUrlBoldItalic,
    customFontEnabled,
  ]);

  const dummyGrid = useMemo(() => {
    return fromCells({
      width: 3,
      height: 3,
      cells: ['M', 'E', 'L', ' ', ' ', '.', 'O', 'T', ' '],
      allowBlockEditing: false,
      highlighted: new Set<number>(),
      vBars: new Set<number>(),
      hBars: new Set<number>(),
      hidden: new Set<number>(),
      highlight: 'circle',
      mapper: (x) => x,
    });
  }, []);

  const fontStyles: CSSInterpolation[] = [];
  if (fontUrl) {
    fontStyles.push(fontFace(fontUrl, 'CrossharePreview', 'normal', 'normal'));
    if (fontUrlBold) {
      fontStyles.push(
        fontFace(fontUrlBold, 'CrossharePreview', 'normal', 'bold')
      );
    }
    if (fontUrlItalic) {
      fontStyles.push(
        fontFace(fontUrlItalic, 'CrossharePreview', 'italic', 'normal')
      );
    }
    if (fontUrlBoldItalic) {
      fontStyles.push(
        fontFace(fontUrlBoldItalic, 'CrossharePreview', 'italic', 'bold')
      );
    }
  }

  return (
    <>
      <p>
        Your theme choices apply to <b>all</b> of your embeds, including
        pre-existing embeds. If you need to use a one-off theme please get in
        touch and we can help. Note: changes can take up to an hour to take
        effect for existing embeds - we cache pages to keep Crosshare fast!
      </p>
      <h4>Colors</h4>
      <h5>Primary Color</h5>
      <ColorPicker
        initial={primary}
        swatchBase={PRIMARY}
        onChange={(c) => {
          setPrimary(c);
          setDirty(true);
        }}
      />
      <h5>Link/Button Color</h5>
      <ColorPicker
        initial={link}
        swatchBase={LINK}
        onChange={(c) => {
          setLink(c);
          setDirty(true);
        }}
      />
      <div>
        <label>
          <input
            css={{ marginRight: '1em' }}
            type="checkbox"
            checked={isDark}
            onChange={(e) => {
              setIsDark(e.target.checked);
              setDirty(true);
            }}
          />
          Dark Mode
        </label>
      </div>
      <div>
        <label>
          <input
            css={{ marginRight: '1em' }}
            disabled={!isDark}
            type="checkbox"
            checked={preservePrimary}
            onChange={(e) => {
              setPreservePrimary(e.target.checked);
              setDirty(true);
            }}
          />
          <span
            css={{
              color: isDark ? 'var(--text)' : 'var(--autofill)',
            }}
          >
            Use exact colors in Dark Mode (default is to dim color choices)
          </span>
        </label>
      </div>
      <h4>Font</h4>
      <div>
        <label>
          <input
            css={{ marginRight: '1em' }}
            type="checkbox"
            checked={customFontEnabled}
            onChange={(e) => {
              setCustomFontEnabled(e.target.checked);
              setDirty(true);
            }}
          />
          Specify a custom font url (advanced)
        </label>
      </div>
      <label css={fontInputLabelCss}>
        Font URL:
        <input
          disabled={!customFontEnabled}
          css={fontUrlInputCss}
          type="text"
          value={fontUrl}
          onChange={(e) => {
            setFontUrl(e.target.value);
            setDirty(true);
          }}
        />
      </label>
      <label css={fontInputLabelCss}>
        Optional Font URL (Bold):
        <input
          disabled={!customFontEnabled || !fontUrl}
          css={fontUrlInputCss}
          type="text"
          value={fontUrlBold}
          onChange={(e) => {
            setFontUrlBold(e.target.value);
            setDirty(true);
          }}
        />
      </label>
      <label css={fontInputLabelCss}>
        Optional Font URL (Italic):
        <input
          disabled={!customFontEnabled || !fontUrl}
          css={fontUrlInputCss}
          type="text"
          value={fontUrlItalic}
          onChange={(e) => {
            setFontUrlItalic(e.target.value);
            setDirty(true);
          }}
        />
      </label>
      <label css={fontInputLabelCss}>
        Optional Font URL (Bold + Italic):
        <input
          disabled={!customFontEnabled || !fontUrl}
          css={fontUrlInputCss}
          type="text"
          value={fontUrlBoldItalic}
          onChange={(e) => {
            setFontUrlBoldItalic(e.target.value);
            setDirty(true);
          }}
        />
      </label>
      <Button
        css={{ marginTop: '1em' }}
        onClick={saveTheme}
        disabled={saving || !dirty}
        text={saving ? 'Saving...' : 'Save Theme Choices'}
      />
      <h4 css={{ marginTop: '2em' }}>Preview</h4>
      {customFontEnabled && fontStyles.length ? (
        <Global styles={fontStyles} />
      ) : (
        ''
      )}
      <div
        css={[
          {
            display: 'flex',
            flexWrap: 'wrap',
            backgroundColor: 'var(--bg)',
            color: 'var(--text)',
            padding: '1em',
            ...(customFontEnabled &&
              fontUrl && {
                fontFamily: 'CrossharePreview',
              }),
          },
          colorTheme({ primary, link, darkMode: isDark, preservePrimary }),
        ]}
      >
        <div css={{ width: 200, height: 200 }}>
          <GridView
            grid={dummyGrid}
            active={{ row: 2, col: 1, dir: Direction.Across }}
            dispatch={() => {
              /* noop */
            }}
          />
        </div>
        <div css={{ width: 200, height: 200, padding: '1em' }}>
          <div>
            Example text (<strong>bold</strong>, <em>italic</em>, and{' '}
            <strong>
              <em>bold italic</em>
            </strong>
            )
          </div>
          <ButtonAsLink
            text="Example Link"
            onClick={() => {
              /*noop*/
            }}
          />
          <Button
            text="Example Button"
            onClick={() => {
              /* noop */
            }}
          />
        </div>
      </div>
    </>
  );
};
