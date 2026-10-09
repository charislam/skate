import { Match, Option } from "effect";

/** Explicit HTML reflection metadata. */
const globalAliases: Readonly<Record<string, string>> = {
  className: "class",
  htmlFor: "for",
  tabIndex: "tabindex",
  accessKey: "accesskey",
  contentEditable: "contenteditable",
  enterKeyHint: "enterkeyhint",
  inputMode: "inputmode",
  virtualKeyboardPolicy: "virtualkeyboardpolicy",
  writingSuggestions: "writingsuggestions",
};
const globalReflections = new Set(
  "id title lang dir hidden inert draggable spellcheck translate slot autofocus nonce popover autocapitalize autocorrect".split(
    " ",
  ),
);
const tagReflections: Readonly<Record<string, string>> = {
  a: "download href hreflang ping referrerPolicy rel target type charset coords name rev shape",
  area: "alt coords download href ping referrerPolicy rel shape target noHref",
  audio: "autoplay controls crossOrigin defaultMuted disableRemotePlayback loop preload src",
  video:
    "autoplay controls crossOrigin defaultMuted disableRemotePlayback loop preload src width height playsInline poster disablePictureInPicture",
  br: "clear",
  caption: "align",
  div: "align",
  dl: "compact",
  h1: "align",
  h2: "align",
  h3: "align",
  h4: "align",
  h5: "align",
  h6: "align",
  legend: "align",
  p: "align",
  pre: "width",
  ul: "compact type",
  base: "href target",
  blockquote: "cite",
  body: "aLink background bgColor link text vLink",
  button:
    "command commandForElement disabled formAction formEnctype formMethod formNoValidate formTarget name type value popoverTargetAction",
  canvas: "width height",
  col: "span width align ch chOff vAlign",
  colgroup: "span width align ch chOff vAlign",
  data: "value",
  del: "cite dateTime",
  details: "name open",
  dialog: "open closedBy",
  embed: "height name src type width align",
  fieldset: "disabled name",
  form: "acceptCharset action autocomplete encoding enctype method name noValidate target rel",
  hr: "align color noShade size width",
  html: "version",
  iframe:
    "allow allowFullscreen height loading name referrerPolicy src width align frameBorder longDesc marginHeight marginWidth scrolling",
  img: "alt crossOrigin decoding fetchPriority height isMap loading referrerPolicy sizes src srcset useMap width align border hspace longDesc lowsrc name vspace",
  input:
    "accept alt autocomplete capture dirName disabled formAction formEnctype formMethod formNoValidate formTarget height max maxLength min minLength multiple name pattern placeholder readOnly required size src step type useMap width align webkitdirectory popoverTargetAction",
  ins: "cite dateTime",
  label: "htmlFor",
  li: "value type",
  link: "as crossOrigin disabled fetchPriority href hreflang integrity media referrerPolicy rel type charset rev target imageSizes imageSrcset",
  map: "name",
  menu: "compact",
  meta: "content httpEquiv name scheme media",
  meter: "high low max min optimum value",
  object:
    "data height name type useMap width align archive border code codeBase codeType declare hspace standby vspace",
  ol: "compact reversed start type",
  optgroup: "disabled label",
  option: "disabled label value",
  output: "name",
  param: "name type value valueType",
  progress: "max value",
  q: "cite",
  script:
    "async crossOrigin defer fetchPriority integrity noModule referrerPolicy src type charset event htmlFor",
  select: "autocomplete disabled multiple name required size",
  slot: "name",
  source: "height media sizes src srcset type width",
  style: "media type disabled",
  table: "align bgColor border cellPadding cellSpacing frame rules summary width",
  tbody: "align ch chOff vAlign",
  thead: "align ch chOff vAlign",
  tfoot: "align ch chOff vAlign",
  td: "abbr align axis bgColor ch chOff colSpan headers height noWrap rowSpan scope vAlign width",
  th: "abbr align axis bgColor ch chOff colSpan headers height noWrap rowSpan scope vAlign width",
  textarea:
    "autocomplete cols dirName disabled maxLength minLength name placeholder readOnly required rows wrap",
  template:
    "shadowRootClonable shadowRootCustomElementRegistry shadowRootDelegatesFocus shadowRootMode shadowRootSerializable",
  time: "dateTime",
  track: "default kind label src srclang",
  tr: "align bgColor ch chOff vAlign",
};
const aliases: Readonly<Record<string, string>> = {
  defaultMuted: "muted",
  ch: "char",
  chOff: "charoff",
  commandForElement: "commandfor",
  popoverTargetElement: "popovertarget",
  acceptCharset: "accept-charset",
  encoding: "enctype",
  httpEquiv: "http-equiv",
};
const coupled: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  a: {
    href: "href",
    hash: "href",
    host: "href",
    hostname: "href",
    password: "href",
    pathname: "href",
    port: "href",
    protocol: "href",
    search: "href",
    username: "href",
  },
  area: {
    href: "href",
    hash: "href",
    host: "href",
    hostname: "href",
    password: "href",
    pathname: "href",
    port: "href",
    protocol: "href",
    search: "href",
    username: "href",
  },
  audio: { muted: "muted", defaultMuted: "muted" },
  video: { muted: "muted", defaultMuted: "muted" },
  input: {
    value: "value",
    defaultValue: "value",
    valueAsDate: "value",
    valueAsNumber: "value",
    checked: "checked",
    defaultChecked: "checked",
  },
  textarea: { value: "value", defaultValue: "value" },
  option: { selected: "selected", defaultSelected: "selected" },
  select: { value: "selection", selectedIndex: "selection" },
  output: { value: "value", defaultValue: "value" },
};

export const destination = (options: {
  element: HTMLElement;
  kind: "attribute" | "property";
  name: string;
}): string => {
  const { element, kind, name } = options;
  const tag = element.localName;
  return Match.value(kind).pipe(
    Match.when("attribute", () => `attribute:${name.toLowerCase()}`),
    Match.when("property", () =>
      Option.match(Option.fromUndefinedOr(coupled[tag]?.[name]), {
        onSome: (group) => `attribute:${group}`,
        onNone: () =>
          Option.match(Option.fromUndefinedOr(globalAliases[name]), {
            onSome: (attribute) => `attribute:${attribute}`,
            onNone: () =>
              Match.value(
                globalReflections.has(name) ||
                  (tagReflections[tag] ?? "").split(" ").includes(name) ||
                  name === "role" ||
                  name === "popoverTargetElement" ||
                  /^aria[A-Z]/.test(name),
              ).pipe(
                Match.when(
                  true,
                  () =>
                    `attribute:${Option.getOrElse(Option.fromUndefinedOr(aliases[name]), () =>
                      name
                        .replace(/^aria/, "aria-")
                        .replace(/Elements?$/, "")
                        .toLowerCase(),
                    )}`,
                ),
                Match.orElse(() => `property:${name}`),
              ),
          }),
      }),
    ),
    Match.exhaustive,
  );
};

/** Look up a native descriptor without executing its setter. */
export const propertyDescriptor = (options: {
  element: object;
  name: string;
}): Option.Option<PropertyDescriptor> => {
  const descriptor = Option.fromUndefinedOr(
    Object.getOwnPropertyDescriptor(options.element, options.name),
  );
  return Option.orElse(descriptor, () =>
    Option.match(Option.fromNullishOr<object>(Object.getPrototypeOf(options.element)), {
      onNone: () => Option.none(),
      onSome: (prototype) => propertyDescriptor({ element: prototype, name: options.name }),
    }),
  );
};
