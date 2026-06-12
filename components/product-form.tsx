import {
  useCallback,
  useEffect,
  useState,
  useContext,
  useMemo,
  useRef,
} from "react";
import CryptoJS from "crypto-js";
import { useRouter } from "next/router";
import { useForm, Controller } from "react-hook-form";
import {
  Modal,
  ModalContent,
  ModalHeader,
  ModalBody,
  ModalFooter,
  Button,
  Textarea,
  Input,
  Select,
  SelectItem,
  SelectSection,
  Chip,
  Image,
  Switch,
} from "@heroui/react";
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  InformationCircleIcon,
  TrashIcon,
} from "@heroicons/react/24/outline";
import { Carousel } from "react-responsive-carousel";
import "react-responsive-carousel/lib/styles/carousel.min.css";
import {
  PREVNEXTBUTTONSTYLES,
  SHOPSTRBUTTONCLASSNAMES,
  CATEGORIES,
  SHIPPING_OPTIONS,
} from "@/utils/STATIC-VARIABLES";
import {
  PostListing,
  getLocalStorageData,
  finalizeAndSendNostrEvent,
} from "@/utils/nostr/nostr-helper-functions";
import LocationDropdown from "./utility-components/dropdowns/location-dropdown";
import ConfirmActionDropdown from "./utility-components/dropdowns/confirm-action-dropdown";
import {
  ProductContext,
  ProfileMapContext,
  SiteLanguageContext,
  TaxonomyContext,
} from "../utils/context/context";
import { ProductData } from "@/utils/parsers/product-parser-functions";
import {
  formatCurrentDateTimeLocalValue,
  formatUnixTimestampAsDateTimeLocalValue,
} from "@/utils/datetime-local";
import { buildSrcSet } from "@/utils/images";
import { FileUploaderButton } from "./utility-components/file-uploader";
import currencySelection from "../public/currencySelection.json";
import {
  NostrContext,
  SignerContext,
} from "@/components/utility-components/nostr-context-provider";
import { ProductFormValues } from "../utils/types/types";
import { useTheme } from "next-themes";
import {
  encodeTaxonomyAddressTags,
  encodeTaxonomyAssertions,
} from "@/utils/taxonomy/assertions";
import { getTaxonomyNodeLabel, normalizeRef } from "@/utils/taxonomy/registry";
import {
  getThingSearchSuggestions,
  TaxonomySearchSuggestion,
} from "@/utils/taxonomy/search";
import {
  buildActiveListingState,
  buildListingTaxonomyRefAssertions,
  createEmptyListingTaxonomyState,
  deriveLegacyCategoryTags,
  type PropRenderNode,
} from "@/utils/taxonomy/listing-state";
import {
  clearListingTaxonomySelections,
  clearPropForListing,
  hydrateListingTaxonomyStateFromProduct,
  removeOverlayForListing,
  selectCompatibleSegmentForListing,
  selectThingForListing,
  setLiteralForListing,
  setPropValueForListing,
  toggleContextForListing,
} from "@/utils/taxonomy/listing-actions";
import {
  ProductTaxonomy,
  ProductTaxonomyLiteralAssertion,
  ProductTaxonomyRefAssertion,
  TaxonomyState,
} from "@/utils/taxonomy/types";
import { translateUi } from "@/utils/i18n-translations";
import { getTaxonomyDisplayLabel } from "@/utils/taxonomy/display";
import {
  TAXONOMY_CHIP_CLASS,
  TaxonomyPill,
} from "@/components/utility-components/taxonomy-chip";
import { validateProductTaxonomy } from "@/utils/taxonomy/validation";

function parseLiteralInput(rawValue: string): unknown {
  if (!rawValue) return "";
  try {
    return JSON.parse(rawValue);
  } catch {
    return rawValue;
  }
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

function renderLiteralInputType(valueTypeRef: string): "text" | "number" {
  const normalized = normalizeRef(valueTypeRef);
  if (
    normalized === "valtype:integer" ||
    normalized === "valtype:year" ||
    normalized === "valtype:decimal"
  ) {
    return "number";
  }
  return "text";
}

interface ProductFormProps {
  handleModalToggle: () => void;
  showModal: boolean;
  oldValues?: ProductData;
  handleDelete?: (productId: string) => void;
  onSubmitCallback?: () => void;
}

export default function ProductForm({
  showModal,
  handleModalToggle,
  oldValues,
  handleDelete,
  onSubmitCallback,
}: ProductFormProps) {
  const router = useRouter();
  const { theme } = useTheme();
  const [images, setImages] = useState<string[]>([]);
  const [imageError, setImageError] = useState<string | null>(null);
  const [taxonomyError, setTaxonomyError] = useState<string | null>(null);
  const [currentSlide, setCurrentSlide] = useState(0);
  const [pubkey, setPubkey] = useState("");
  const [relayHint, setRelayHint] = useState("");
  const [isEdit, setIsEdit] = useState(false);
  const [isPostingOrUpdatingProduct, setIsPostingOrUpdatingProduct] =
    useState(false);
  const [showOptionalTags, setShowOptionalTags] = useState(false);
  const [isFlashSale, setIsFlashSale] = useState(false);
  const productEventContext = useContext(ProductContext);
  const profileContext = useContext(ProfileMapContext);
  const { siteLanguage } = useContext(SiteLanguageContext);
  const t = (key: string) => translateUi(siteLanguage, key);
  const taxonomyContext = useContext(TaxonomyContext);
  const { registry } = taxonomyContext;
  const [taxonomyState, setTaxonomyState] = useState<TaxonomyState>(() =>
    createEmptyListingTaxonomyState()
  );
  const [thingSearchQuery, setThingSearchQuery] = useState("");
  const [showThingSearchSuggestions, setShowThingSearchSuggestions] =
    useState(false);
  const didInitializeRef = useRef(false);
  const userTouchedFormRef = useRef(false);
  const userEditedProductNameRef = useRef(false);
  const {
    signer,
    isLoggedIn,
    pubkey: signerPubKey,
  } = useContext(SignerContext);
  const { nostr } = useContext(NostrContext);

  const { handleSubmit, control, reset, watch, setValue } = useForm({
    defaultValues: oldValues
      ? {
          "Product Name": oldValues.title,
          Description: oldValues.summary,
          Price: String(oldValues.price),
          Currency: oldValues.currency,
          Location: oldValues.location,
          "Shipping Option": oldValues.shippingType,
          "Shipping Cost": oldValues.shippingCost,
          "Pickup Locations": oldValues.pickupLocations || [""],
          Category: oldValues.categories ? oldValues.categories.join(",") : "",
          Quantity: oldValues.quantity ? String(oldValues.quantity) : "",
          Sizes: oldValues.sizes ? oldValues.sizes.join(",") : "",
          "Size Quantities": oldValues.sizeQuantities
            ? oldValues.sizeQuantities
            : new Map<string, number>(),
          Volumes: oldValues.volumes ? oldValues.volumes.join(",") : "",
          "Volume Prices": oldValues.volumePrices
            ? oldValues.volumePrices
            : new Map<string, number>(),
          Weights: oldValues.weights ? oldValues.weights.join(",") : "",
          "Weight Prices": oldValues.weightPrices
            ? oldValues.weightPrices
            : new Map<string, number>(),
          "Bulk Pricing Enabled": oldValues.bulkPrices
            ? oldValues.bulkPrices.size > 0
            : false,
          "Bulk Prices": oldValues.bulkPrices
            ? oldValues.bulkPrices
            : new Map<number, number>(),
          Condition: oldValues.condition ? oldValues.condition : "",
          Status: oldValues.status ? oldValues.status : "",
          Required: oldValues.required ? oldValues.required : "",
          Restrictions: oldValues.restrictions ? oldValues.restrictions : "",
          Expiration: oldValues.expiration
            ? formatUnixTimestampAsDateTimeLocalValue(oldValues.expiration)
            : "",
        }
      : {
          Currency: "SAT",
          "Shipping Option": "N/A",
          Status: "active",
          "Pickup Locations": [""],
        },
  });

  useEffect(() => {
    if (typeof window !== "undefined") {
      const { relays } = getLocalStorageData();
      setPubkey(signerPubKey as string);
      setRelayHint(relays[0] as string);
    }
  }, [signerPubKey]);

  const implicitBusinessFunctionRef = registry?.nodeByRef[
    "val:business_function:sell"
  ]
    ? "val:business_function:sell"
    : "";

  useEffect(() => {
    if (!showModal) {
      didInitializeRef.current = false;
      userTouchedFormRef.current = false;
      userEditedProductNameRef.current = false;
      return;
    }

    if (didInitializeRef.current && userTouchedFormRef.current) return;

    setImages(oldValues?.images || []);
    setIsEdit(Boolean(oldValues));
    setTaxonomyState(
      registry
        ? hydrateListingTaxonomyStateFromProduct(
            {
              overlayValRefs: oldValues?.taxonomy?.overlayValRefs || [],
              primaryThingRef: oldValues?.taxonomy?.primaryThingRef || null,
              refAssertions: oldValues?.taxonomy?.refAssertions || [],
              literalAssertions: oldValues?.taxonomy?.literalAssertions || [],
              implicitBusinessFunctionRef,
            },
            registry
          )
        : createEmptyListingTaxonomyState()
    );
    didInitializeRef.current = true;
  }, [showModal, oldValues, registry, implicitBusinessFunctionRef]);

  useEffect(() => {
    if (showModal && !oldValues && signerPubKey) {
      const profile = profileContext.profileData.get(signerPubKey);
      const hasLightning = !!(
        profile?.content?.lud16 || profile?.content?.lnurl
      );
      setIsFlashSale(hasLightning);
    } else {
      setIsFlashSale(false);
    }
  }, [showModal, signerPubKey, profileContext, oldValues]);

  const activeListingState = useMemo(
    () =>
      registry
        ? buildActiveListingState(taxonomyState, registry, {
            implicitBusinessFunctionRef,
            locale: siteLanguage,
          })
        : null,
    [implicitBusinessFunctionRef, registry, siteLanguage, taxonomyState]
  );

  const thingSearchSuggestions = useMemo(
    () =>
      registry
        ? getThingSearchSuggestions(
            registry,
            thingSearchQuery,
            siteLanguage,
            60,
            true
          )
        : [],
    [registry, siteLanguage, thingSearchQuery]
  );
  const compatibleSegmentRefs = activeListingState?.compatibleSegmentRefs || [];
  const availableSegmentRefs = activeListingState?.availableSegmentRefs || [];
  const fixedSegmentRef = activeListingState?.fixedSegmentRef || "";
  const selectedThingRef = activeListingState?.selectedThingRef || "";
  const selectedSegmentRef = activeListingState?.primarySegmentRef || "";
  const selectedSemanticContextRefs =
    activeListingState?.selectedSemanticContextRefs || [];
  const activeSelectedSegmentRefs =
    activeListingState?.activeSelectedSegmentRefs || [];
  const selectedSegmentRefs = activeListingState?.selectedSegmentRefs || [];
  const serializedRequiredRefs =
    activeListingState?.serializedRequiredRefs || [];
  const requiredContextRefs = activeListingState?.requiredContextRefs || [];
  const automaticRequiredContextRefs =
    activeListingState?.automaticRequiredContextRefs || new Set<string>();
  const semanticOverlayOptions =
    activeListingState?.semanticOverlayOptions || [];
  const overlayGroups = activeListingState?.overlayGroups || {};
  const validLegacyOverlayRefs =
    activeListingState?.validLegacyOverlayRefs || [];
  const serializedOverlayValRefs =
    activeListingState?.serializedOverlayValRefs || [];
  const requiredPropRefs = activeListingState?.requiredPropRefs || [];
  const orderedApplicablePropRefs =
    activeListingState?.orderedApplicablePropRefs || [];
  const propFieldTree = activeListingState?.propFieldTree || [];
  const availableValuesByProp = activeListingState?.availableValuesByProp || {};
  const propValueTypeByProp = activeListingState?.propValueTypeByProp || {};
  const propTargetRefsByProp = activeListingState?.propTargetRefsByProp || {};
  const selectedValueRefsByProp =
    activeListingState?.selectedValueRefsByProp || {};
  const selectedLiteralByProp = activeListingState?.selectedLiteralByProp || {};
  const fieldLabelsByProp = activeListingState?.fieldLabelsByProp || {};
  const literalPlaceholderByProp =
    activeListingState?.literalPlaceholderByProp || {};
  const autoProductName = activeListingState?.autoProductName || "";
  const missingRequiredContextRefs =
    activeListingState?.missingRequiredContextRefs || [];
  const missingRequiredPropRefs =
    activeListingState?.missingRequiredPropRefs || [];
  const hasAnyTaxonomyAttribute = Boolean(activeListingState?.hasAnyAttribute);
  const unselectedAvailableSegmentRefs = availableSegmentRefs.filter(
    (ref) => normalizeRef(ref) !== normalizeRef(selectedSegmentRef)
  );

  const dispatchTaxonomyAction = useCallback(
    (action: (current: TaxonomyState) => TaxonomyState) => {
      if (!registry) return;
      setTaxonomyState((current) => action(current));
      setTaxonomyError(null);
    },
    [registry]
  );

  const resetTaxonomySelections = useCallback(
    (
      _source: string = "taxonomy reset",
      overrides: Partial<{
        primarySegmentRef: string | null;
        primaryThingRef: string | null;
        selectedThingPath: string[];
      }> = {}
    ) => {
      if (registry) {
        dispatchTaxonomyAction((current) =>
          clearListingTaxonomySelections(current, registry, {
            segmentRef: Object.prototype.hasOwnProperty.call(
              overrides,
              "primarySegmentRef"
            )
              ? (overrides.primarySegmentRef ?? null)
              : current.segmentRef,
            thingRef: Object.prototype.hasOwnProperty.call(
              overrides,
              "primaryThingRef"
            )
              ? (overrides.primaryThingRef ?? null)
              : current.thingRef,
            thingPath: Object.prototype.hasOwnProperty.call(
              overrides,
              "selectedThingPath"
            )
              ? overrides.selectedThingPath || []
              : current.thingPath,
          })
        );
      }
      setTaxonomyError(null);
    },
    [dispatchTaxonomyAction, registry]
  );

  const selectThingFromSearch = (suggestion: TaxonomySearchSuggestion) => {
    if (!registry) return;
    const nextTaxonomyState = selectThingForListing(
      taxonomyState,
      suggestion.ref,
      registry
    );

    userTouchedFormRef.current = true;
    setThingSearchQuery(suggestion.label);
    setShowThingSearchSuggestions(false);
    setTaxonomyState(nextTaxonomyState);
    setTaxonomyError(null);
  };

  const setSelectedCategorySegments = (nextSegmentRefs: string[]) => {
    if (!registry) return;
    const nextSegmentRef =
      uniqueStrings(nextSegmentRefs.map(normalizeRef))
        .filter((ref) => ref.startsWith("val:context:segment:"))
        .find(Boolean) || "";
    dispatchTaxonomyAction((current) =>
      selectCompatibleSegmentForListing(
        current,
        nextSegmentRef || null,
        compatibleSegmentRefs,
        registry
      )
    );
  };

  const clearSelectedThing = () => {
    if (!registry) return;
    setThingSearchQuery("");
    setShowThingSearchSuggestions(false);
    resetTaxonomySelections("thing cleared", {
      primarySegmentRef: null,
      primaryThingRef: null,
      selectedThingPath: [],
    });
  };

  const onSubmit = async (data: {
    [x: string]: string | Map<string, number> | string[];
  }) => {
    if (images.length === 0) {
      setImageError("At least one image is required.");
      return;
    } else {
      setImageError(null);
    }

    if (registry && !activeListingState?.selectedThingRef) {
      setTaxonomyError("Choose what type of item you are listing.");
      return;
    }
    if (registry && !activeListingState?.selectedThingExists) {
      setTaxonomyError("Choose a valid item type.");
      return;
    }
    if (registry && !activeListingState?.hasRequiredSegment) {
      setTaxonomyError("Choose at least one marketplace segment.");
      return;
    }
    if (registry && !activeListingState?.hasExactlyOneSegment) {
      setTaxonomyError("Choose exactly one marketplace segment.");
      return;
    }
    if (
      registry &&
      activeListingState?.submitBlockReason === "multiple_required_segments"
    ) {
      setTaxonomyError(
        "This item type has more than one required segment in the taxonomy."
      );
      return;
    }
    if (
      registry &&
      fixedSegmentRef &&
      activeListingState?.primarySegmentRef !== fixedSegmentRef
    ) {
      setTaxonomyError(
        "Use the required marketplace segment for this item type."
      );
      return;
    }
    if (missingRequiredContextRefs.length > 0 && registry) {
      setTaxonomyError(
        `Complete the required context: ${missingRequiredContextRefs
          .map((ref) => getTaxonomyNodeLabel(registry, ref, siteLanguage))
          .join(", ")}`
      );
      return;
    }
    if (missingRequiredPropRefs.length > 0 && registry) {
      setTaxonomyError(
        `Complete the required details: ${missingRequiredPropRefs
          .map((propRef) =>
            getTaxonomyNodeLabel(registry, propRef, siteLanguage)
          )
          .join(", ")}`
      );
      return;
    }
    if (
      orderedApplicablePropRefs.length > 0 &&
      !hasAnyTaxonomyAttribute &&
      typeof window !== "undefined" &&
      !window.confirm("You haven’t filled out any attributes. Continue?")
    ) {
      return;
    }
    setTaxonomyError(null);

    setIsPostingOrUpdatingProduct(true);
    const hashHex = CryptoJS.SHA256(data["Product Name"] as string).toString(
      CryptoJS.enc.Hex
    );

    const tags: ProductFormValues = [
      ["d", oldValues?.d || hashHex],
      ["alt", ("Product listing: " + data["Product Name"]) as string],
      [
        "client",
        "Shopstr",
        "31990:" + pubkey + ":" + (oldValues?.d || hashHex),
        relayHint,
      ],
      ["title", data["Product Name"] as string],
      ["summary", data["Description"] as string],
      ["price", data["Price"] as string, data["Currency"] as string],
      ["location", data["Location"] as string],
      [
        "shipping",
        data["Shipping Option"] as string,
        data["Shipping Cost"] ? (data["Shipping Cost"] as string) : "0",
        data["Currency"] as string,
      ],
    ];

    images.forEach((image) => {
      tags.push(["image", image]);
    });

    const manualCategories =
      typeof data["Category"] === "string"
        ? (data["Category"] as string)
            .split(",")
            .map((category) => category.trim())
            .filter(Boolean)
        : [];
    const taxonomyDerivedCategories = registry
      ? deriveLegacyCategoryTags(
          registry,
          selectedThingRef,
          serializedOverlayValRefs,
          siteLanguage
        )
      : [];
    uniqueStrings([...manualCategories, ...taxonomyDerivedCategories]).forEach(
      (category) => {
        tags.push(["t", category]);
      }
    );
    tags.push(["t", "shopstr"]);

    const taxonomyRefAssertionsList: ProductTaxonomyRefAssertion[] =
      activeListingState
        ? buildListingTaxonomyRefAssertions(activeListingState)
        : [];
    const taxonomyLiteralAssertionsList: ProductTaxonomyLiteralAssertion[] =
      Object.entries(selectedLiteralByProp)
        .filter(([_, value]) => String(value).trim().length > 0)
        .map(([propRef, value]) => ({
          propRef,
          valueTypeRef: propValueTypeByProp[propRef] || "valtype:text",
          value: parseLiteralInput(String(value)),
        }));

    const listingTaxonomy: ProductTaxonomy = {
      primaryThingRef: selectedThingRef
        ? normalizeRef(selectedThingRef)
        : undefined,
      overlayValRefs: serializedOverlayValRefs.map(normalizeRef),
      requiredRefs: serializedRequiredRefs.map(normalizeRef),
      refAssertions: taxonomyRefAssertionsList,
      literalAssertions: taxonomyLiteralAssertionsList,
    };

    if (registry) {
      const validation = validateProductTaxonomy(listingTaxonomy, registry, {
        mode: "publish",
        content: String(data["Description"] || ""),
        implicitBusinessFunctionRef,
      });
      if (!validation.ok) {
        setTaxonomyError(validation.errors.join(" "));
        setIsPostingOrUpdatingProduct(false);
        return;
      }
      if (validation.warnings.length > 0) {
        console.warn("Taxonostr taxonomy warnings:", validation.warnings);
      }
    }
    tags.push(...encodeTaxonomyAssertions(listingTaxonomy));
    tags.push(...encodeTaxonomyAddressTags(listingTaxonomy, registry));

    if (data["Quantity"]) {
      tags.push(["quantity", data["Quantity"].toString()]);
    }

    if (data["Sizes"]) {
      const sizesArray = Array.isArray(data["Sizes"])
        ? data["Sizes"]
        : (data["Sizes"] as string).split(",").filter(Boolean);
      sizesArray.forEach((size) => {
        const quantity =
          (data["Size Quantities"] as Map<string, number>).get(size) || 0;
        tags.push(["size", size, quantity.toString()]);
      });
    }

    if (data["Volumes"]) {
      const volumesArray = Array.isArray(data["Volumes"])
        ? data["Volumes"]
        : (data["Volumes"] as string).split(",").filter(Boolean);
      volumesArray.forEach((volume) => {
        const price =
          (data["Volume Prices"] as Map<string, number>).get(volume) || 0;
        tags.push(["volume", volume, price.toString()]);
      });
    }

    if (data["Weights"]) {
      const weightsArray = Array.isArray(data["Weights"])
        ? data["Weights"]
        : (data["Weights"] as string).split(",").filter(Boolean);
      weightsArray.forEach((weight) => {
        const price =
          (data["Weight Prices"] as Map<string, number>).get(weight) || 0;
        tags.push(["weight", weight, price.toString()]);
      });
    }

    if (data["Bulk Pricing Enabled"] && data["Bulk Prices"]) {
      const bulkPrices = data["Bulk Prices"] as unknown as Map<number, number>;
      bulkPrices.forEach((price, units) => {
        if (units > 0 && price > 0) {
          tags.push(["bulk", units.toString(), price.toString()]);
        }
      });
    }

    if (data["Condition"]) {
      tags.push(["condition", data["Condition"] as string]);
    }

    if (data["Status"]) {
      tags.push(["status", data["Status"] as string]);
    }

    if (data["Required"]) {
      tags.push(["required", data["Required"] as string]);
    }

    if (data["Restrictions"]) {
      tags.push(["restrictions", data["Restrictions"] as string]);
    }

    if (data["Expiration"]) {
      const dateObj = new Date(data["Expiration"] as string);
      if (!isNaN(dateObj.getTime())) {
        const unixTime = Math.floor(dateObj.getTime() / 1000);
        tags.push(["valid_until", unixTime.toString()]);
      }
    }

    // Add pickup locations if they exist and shipping involves pickup
    if (
      data["Pickup Locations"] &&
      Array.isArray(data["Pickup Locations"]) &&
      (data["Shipping Option"] === "Pickup" ||
        data["Shipping Option"] === "Free/Pickup")
    ) {
      (data["Pickup Locations"] as string[])
        .filter((location) => location.trim() !== "")
        .forEach((location) => {
          tags.push(["pickup_location", location.trim()]);
        });
    }

    const newListing = await PostListing(tags, signer!, isLoggedIn!, nostr!);

    //Handle Flash Sale (Zapsnag) Publication
    if (isFlashSale) {
      try {
        const finalContent = `${data["Description"]}\n\nPrice: ${
          data["Price"]
        } ${data["Currency"]}\n\n#zapsnag\n${images[0] || ""}`;
        const flashSaleEvent = {
          kind: 1,
          created_at: Math.floor(Date.now() / 1000),
          tags: [
            ["t", "zapsnag"],
            ["t", "shopstr-zapsnag"],
            ["d", "zapsnag"],
          ],
          content: finalContent,
        };

        if (data["Quantity"]) {
          flashSaleEvent.tags.push(["quantity", data["Quantity"].toString()]);
        }
        if (images[0]) flashSaleEvent.tags.push(["image", images[0]]);
        await finalizeAndSendNostrEvent(signer!, nostr!, flashSaleEvent);
      } catch (e) {
        console.error("Failed to publish flash sale note", e);
      }
    }

    if (isEdit) {
      if (handleDelete && oldValues?.id) {
        handleDelete(oldValues.id);
      }
    }

    clear();
    productEventContext.addNewlyCreatedProductEvent(newListing);
    setIsPostingOrUpdatingProduct(false);
    if (onSubmitCallback) {
      onSubmitCallback();
    }
  };

  const clear = () => {
    handleModalToggle();
    setImages([]);
    resetTaxonomySelections();
    reset();
    setCurrentSlide(0);
    setLastAutoProductName("");
    didInitializeRef.current = false;
    userTouchedFormRef.current = false;
    userEditedProductNameRef.current = false;
  };

  const watchShippingOption = watch("Shipping Option");
  const watchCurrency = watch("Currency");
  const watchProductName = watch("Product Name");
  const [lastAutoProductName, setLastAutoProductName] = useState("");

  useEffect(() => {
    if (!autoProductName || userEditedProductNameRef.current) return;
    if (!watchProductName || watchProductName === lastAutoProductName) {
      setValue("Product Name", autoProductName, { shouldDirty: true });
      setLastAutoProductName(autoProductName);
    }
  }, [autoProductName, lastAutoProductName, setValue, watchProductName]);

  const deleteImage = (index: number) => () => {
    setImages((prevValues) => {
      const updatedImages = [...prevValues];
      if (index > -1) {
        updatedImages.splice(index, 1);
      }
      const newCurrentSlide = Math.min(currentSlide, updatedImages.length - 1);
      setCurrentSlide(newCurrentSlide >= 0 ? newCurrentSlide : 0);
      return updatedImages;
    });
  };

  const currencyOptions = Object.keys(currencySelection).map((code) => ({
    value: code,
  }));

  const renderPropField = (node: PropRenderNode, depth: number = 0) => {
    if (!registry) return null;
    const propRef = node.propRef;
    const propNode = registry.nodeByRef[propRef];
    if (!propNode) return null;
    const propLabel =
      fieldLabelsByProp[propRef] ||
      getTaxonomyNodeLabel(registry, propRef, siteLanguage);
    const isRequiredProp = requiredPropRefs.includes(propRef);
    const refOptions = availableValuesByProp[propRef] || [];
    const literalValueTypeRef = propValueTypeByProp[propRef] || "";
    const propNodeTargets = propTargetRefsByProp[propRef] || [];
    if (
      !isRequiredProp &&
      propNodeTargets.length > 0 &&
      refOptions.length === 0
    ) {
      return null;
    }
    if (
      !isRequiredProp &&
      propNodeTargets.length === 0 &&
      !literalValueTypeRef
    ) {
      return null;
    }

    return (
      <div
        key={propRef}
        className={
          depth > 0
            ? "border-default-200 dark:border-default-700 space-y-2 border-l pl-3"
            : "space-y-2"
        }
      >
        <div className="space-y-1">
          <label className="text-light-text dark:text-dark-text block text-sm font-medium">
            {propLabel}
            {isRequiredProp ? " *" : ""}
          </label>
          {propNodeTargets.length > 0 ? (
            <select
              data-tax-prop={propRef}
              className="text-light-text dark:text-dark-text w-full rounded-md border border-gray-300 bg-transparent p-2 text-sm dark:border-gray-700"
              value={selectedValueRefsByProp[propRef]?.[0] || ""}
              onChange={(e) => {
                const valueRef = e.target.value;
                dispatchTaxonomyAction((current) =>
                  valueRef
                    ? setPropValueForListing(
                        current,
                        propRef,
                        [valueRef],
                        registry
                      )
                    : clearPropForListing(current, propRef, registry)
                );
              }}
            >
              <option value="">{t("Choose an option")}</option>
              {refOptions.map((valueRef) => (
                <option key={valueRef} value={valueRef}>
                  {getTaxonomyNodeLabel(registry, valueRef, siteLanguage)}
                </option>
              ))}
            </select>
          ) : normalizeRef(literalValueTypeRef) === "valtype:boolean" ? (
            <div className="mt-2 flex items-center gap-2">
              <input
                type="checkbox"
                checked={
                  String(selectedLiteralByProp[propRef] || "") === "true"
                }
                onChange={(e) => {
                  dispatchTaxonomyAction((current) =>
                    setLiteralForListing(
                      current,
                      propRef,
                      e.target.checked ? "true" : "false",
                      registry
                    )
                  );
                }}
              />
              <span className="text-sm text-gray-500">{propLabel}</span>
            </div>
          ) : (
            <Input
              className="text-light-text dark:text-dark-text"
              variant="bordered"
              value={String(selectedLiteralByProp[propRef] || "")}
              onChange={(e) =>
                dispatchTaxonomyAction((current) =>
                  setLiteralForListing(
                    current,
                    propRef,
                    e.target.value,
                    registry
                  )
                )
              }
              type={
                literalValueTypeRef
                  ? renderLiteralInputType(literalValueTypeRef)
                  : "text"
              }
              placeholder={
                normalizeRef(literalValueTypeRef) === "valtype:quantitative"
                  ? '{"value": 1, "unit": "count"}'
                  : literalPlaceholderByProp[propRef] || "Enter value"
              }
            />
          )}
        </div>
        {node.children.length > 0 && (
          <div className="space-y-3">
            {node.children.map((childNode) =>
              renderPropField(childNode, depth + 1)
            )}
          </div>
        )}
      </div>
    );
  };

  return (
    <Modal
      backdrop="blur"
      isOpen={showModal}
      onClose={handleModalToggle}
      classNames={{
        body: "py-6",
        backdrop: "bg-[#292f46]/50 backdrop-opacity-60",
        // base: "border-[#292f46] bg-[#19172c] dark:bg-[#19172c] text-[#a8b0d3]",
        header: "border-b-[1px] border-[#292f46]",
        footer: "border-t-[1px] border-[#292f46]",
        closeButton: "hover:bg-black/5 active:bg-white/10",
      }}
      scrollBehavior={"outside"}
      size="2xl"
    >
      <ModalContent>
        <ModalHeader className="text-light-text dark:text-dark-text flex flex-col gap-1">
          Add New Product Listing
        </ModalHeader>
        <form
          onChangeCapture={() => {
            userTouchedFormRef.current = true;
          }}
          onSubmit={(e) => {
            if (e.target !== e.currentTarget) {
              e.preventDefault();
            }
            return handleSubmit(onSubmit as any)(e);
          }}
        >
          <ModalBody>
            {registry && (
              <div className="rounded-lg border border-gray-200 p-4 dark:border-gray-700">
                <div className="mb-3 flex items-center justify-between">
                  <div>
                    <p className="text-light-text dark:text-dark-text text-sm font-semibold">
                      Listing taxonomy
                    </p>
                    <p className="text-xs text-gray-500">
                      Search for a specific item type first, then choose only
                      categories that apply.
                    </p>
                  </div>
                  {taxonomyContext.isLoading && (
                    <span className="text-xs text-gray-500">
                      {t("Loading…")}
                    </span>
                  )}
                </div>

                <div className="space-y-4">
                  <div>
                    <label className="text-light-text dark:text-dark-text mb-1 block text-sm font-medium">
                      What type of item are you listing?
                    </label>
                    <div className="relative">
                      <input
                        value={thingSearchQuery}
                        onFocus={() => setShowThingSearchSuggestions(true)}
                        onChange={(event) => {
                          setThingSearchQuery(event.target.value);
                          setShowThingSearchSuggestions(true);
                        }}
                        onKeyDown={(event) => {
                          if (event.key === "Escape") {
                            setShowThingSearchSuggestions(false);
                          }
                        }}
                        placeholder="Search item types"
                        className="text-light-text dark:text-dark-text w-full rounded-md border border-gray-300 bg-transparent p-2 text-sm dark:border-gray-700"
                      />
                      {showThingSearchSuggestions &&
                        thingSearchSuggestions.length > 0 && (
                          <div className="absolute top-full right-0 left-0 z-50 mt-2 max-h-80 overflow-auto rounded-lg border border-gray-200 bg-white shadow-lg dark:border-gray-700 dark:bg-neutral-900">
                            {thingSearchSuggestions.map((suggestion) => (
                              <button
                                key={suggestion.ref}
                                type="button"
                                className="hover:bg-default-100 dark:hover:bg-default-800 flex w-full items-center gap-3 px-3 py-2 text-left text-sm"
                                onMouseDown={(event) => {
                                  event.preventDefault();
                                  selectThingFromSearch(suggestion);
                                }}
                              >
                                <span className="bg-default-100 text-default-500 dark:bg-default-800 flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-md text-sm font-semibold">
                                  {suggestion.image ? (
                                    <Image
                                      src={suggestion.image}
                                      alt=""
                                      width={40}
                                      height={40}
                                      radius="none"
                                      className="h-full w-full object-cover object-center"
                                    />
                                  ) : (
                                    suggestion.label.slice(0, 1)
                                  )}
                                </span>
                                <span className="min-w-0 flex-1">
                                  <span className="text-light-text dark:text-dark-text block truncate font-medium">
                                    {suggestion.label}
                                  </span>
                                  {suggestion.parentLabel && (
                                    <span className="block truncate text-xs text-gray-500">
                                      {suggestion.parentLabel}
                                    </span>
                                  )}
                                </span>
                              </button>
                            ))}
                          </div>
                        )}
                    </div>
                  </div>

                  {(Boolean(selectedThingRef) ||
                    Boolean(selectedSegmentRef) ||
                    selectedSemanticContextRefs.length > 0 ||
                    serializedRequiredRefs.length > 0) && (
                    <div className="flex flex-wrap gap-2">
                      {selectedThingRef && (
                        <TaxonomyPill
                          label={getTaxonomyDisplayLabel(
                            registry,
                            selectedThingRef,
                            siteLanguage,
                            "listingType"
                          )}
                          imageUrl={registry.imageByRef[selectedThingRef]}
                          selected
                          removable
                          removeLabel={`Remove ${getTaxonomyDisplayLabel(
                            registry,
                            selectedThingRef,
                            siteLanguage,
                            "listingType"
                          )}`}
                          onRemove={clearSelectedThing}
                        />
                      )}
                      {selectedSegmentRef && (
                        <TaxonomyPill
                          label={`${getTaxonomyDisplayLabel(
                            registry,
                            selectedSegmentRef,
                            siteLanguage,
                            "category"
                          )}${fixedSegmentRef ? " (required)" : ""}`}
                          imageUrl={registry.imageByRef[selectedSegmentRef]}
                          selected
                          removable={!fixedSegmentRef}
                          removeLabel={`Remove ${getTaxonomyDisplayLabel(
                            registry,
                            selectedSegmentRef,
                            siteLanguage,
                            "category"
                          )}`}
                          onRemove={
                            !fixedSegmentRef
                              ? () => setSelectedCategorySegments([])
                              : undefined
                          }
                        />
                      )}
                      {selectedSemanticContextRefs
                        .filter(
                          (ref) =>
                            !activeSelectedSegmentRefs.includes(
                              normalizeRef(ref)
                            )
                        )
                        .map((ref) => {
                          const isRequiredContext =
                            automaticRequiredContextRefs.has(normalizeRef(ref));
                          return (
                            <TaxonomyPill
                              key={ref}
                              label={`${getTaxonomyDisplayLabel(
                                registry,
                                ref,
                                siteLanguage,
                                "category"
                              )}${isRequiredContext ? " (required)" : ""}`}
                              imageUrl={registry.imageByRef[ref]}
                              selected
                              removable={!isRequiredContext}
                              removeLabel={`Remove ${getTaxonomyDisplayLabel(
                                registry,
                                ref,
                                siteLanguage,
                                "category"
                              )}`}
                              onRemove={
                                !isRequiredContext
                                  ? () =>
                                      dispatchTaxonomyAction((current) =>
                                        removeOverlayForListing(
                                          current,
                                          ref,
                                          registry
                                        )
                                      )
                                  : undefined
                              }
                            />
                          );
                        })}
                      {requiredContextRefs
                        .filter(
                          (ref) =>
                            !selectedSemanticContextRefs
                              .map(normalizeRef)
                              .includes(normalizeRef(ref))
                        )
                        .map((ref) => (
                          <TaxonomyPill
                            key={ref}
                            label={`${getTaxonomyDisplayLabel(
                              registry,
                              ref,
                              siteLanguage,
                              "category"
                            )} (required)`}
                            imageUrl={registry.imageByRef[ref]}
                            selected
                          />
                        ))}
                    </div>
                  )}

                  {selectedThingRef &&
                    unselectedAvailableSegmentRefs.length > 0 && (
                      <div>
                        <label className="text-light-text dark:text-dark-text mb-2 block text-sm font-medium">
                          Choose categories that apply:
                        </label>
                        <div className="flex flex-wrap gap-2">
                          {unselectedAvailableSegmentRefs
                            .slice()
                            .sort((a, b) =>
                              getTaxonomyNodeLabel(
                                registry,
                                a,
                                siteLanguage
                              ).localeCompare(
                                getTaxonomyNodeLabel(registry, b, siteLanguage),
                                siteLanguage
                              )
                            )
                            .map((ref) => (
                              <Chip
                                key={ref}
                                size="sm"
                                variant="bordered"
                                color="default"
                                className={`${TAXONOMY_CHIP_CLASS} cursor-pointer`}
                                onClick={() => {
                                  setSelectedCategorySegments([ref]);
                                }}
                              >
                                {getTaxonomyDisplayLabel(
                                  registry,
                                  ref,
                                  siteLanguage,
                                  "category"
                                )}
                              </Chip>
                            ))}
                        </div>
                      </div>
                    )}

                  {selectedThingRef && semanticOverlayOptions.length > 0 && (
                    <div className="space-y-2 rounded-md border border-gray-200 p-3 dark:border-gray-800">
                      {Object.entries(overlayGroups).map(
                        ([groupLabel, refs]) => (
                          <div key={groupLabel} className="space-y-2">
                            <p className="text-xs font-medium text-gray-500">
                              {groupLabel}
                            </p>
                            <div className="flex flex-wrap gap-2">
                              {refs
                                .slice()
                                .filter(
                                  (ref) =>
                                    !selectedSemanticContextRefs.includes(ref)
                                )
                                .sort((a, b) =>
                                  getTaxonomyNodeLabel(
                                    registry,
                                    a,
                                    siteLanguage
                                  ).localeCompare(
                                    getTaxonomyNodeLabel(
                                      registry,
                                      b,
                                      siteLanguage
                                    ),
                                    siteLanguage
                                  )
                                )
                                .map((ref) => (
                                  <Chip
                                    key={ref}
                                    size="sm"
                                    variant="bordered"
                                    color="default"
                                    className={`${TAXONOMY_CHIP_CLASS} cursor-pointer`}
                                    onClick={() => {
                                      dispatchTaxonomyAction((current) =>
                                        toggleContextForListing(
                                          current,
                                          ref,
                                          registry
                                        )
                                      );
                                    }}
                                  >
                                    {getTaxonomyNodeLabel(
                                      registry,
                                      ref,
                                      siteLanguage
                                    )}
                                  </Chip>
                                ))}
                            </div>
                          </div>
                        )
                      )}
                    </div>
                  )}

                  {validLegacyOverlayRefs.length > 0 && (
                    <div className="space-y-1">
                      <p className="text-xs text-gray-500">
                        Legacy taxonomy refs are preserved on save but do not
                        affect the live form unless you migrate them.
                      </p>
                      <div className="flex flex-wrap gap-2">
                        {validLegacyOverlayRefs.map((ref) => (
                          <Chip
                            key={ref}
                            size="sm"
                            variant="bordered"
                            className={TAXONOMY_CHIP_CLASS}
                            onClose={() =>
                              dispatchTaxonomyAction((current) =>
                                removeOverlayForListing(current, ref, registry)
                              )
                            }
                          >
                            {getTaxonomyNodeLabel(registry, ref, siteLanguage)}
                          </Chip>
                        ))}
                      </div>
                    </div>
                  )}

                  {taxonomyError && (
                    <div className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-500/40 dark:bg-red-500/10 dark:text-red-200">
                      {taxonomyError}
                    </div>
                  )}

                  {selectedSegmentRefs.length > 0 &&
                    orderedApplicablePropRefs.length > 0 && (
                      <div className="space-y-3">
                        <div>
                          <p className="text-light-text dark:text-dark-text text-sm font-medium">
                            {t("Dynamic attributes")}
                          </p>
                          <p className="text-xs text-gray-500">
                            These fields update automatically from the category,
                            subcategory, and extra details you choose.
                          </p>
                        </div>
                        {propFieldTree.map((node) => renderPropField(node))}
                      </div>
                    )}
                </div>
              </div>
            )}
            <Controller
              name="Product Name"
              control={control}
              render={({
                field: { onChange, onBlur, value },
                fieldState: { error },
              }) => {
                const isErrored = error !== undefined;
                const errorMessage: string = error?.message
                  ? error.message
                  : "";
                return (
                  <Input
                    className="text-light-text dark:text-dark-text"
                    variant="bordered"
                    autoFocus
                    fullWidth={true}
                    label="Product name"
                    labelPlacement="inside"
                    isInvalid={isErrored}
                    errorMessage={errorMessage}
                    // controller props
                    onChange={(event) => {
                      userEditedProductNameRef.current = true;
                      onChange(event);
                    }} // send value to hook form
                    onBlur={onBlur} // notify when input is touched/blur
                    value={value}
                  />
                );
              }}
            />
            <Carousel
              showArrows={images.length > 1}
              showStatus={false}
              showIndicators={images.length > 1}
              showThumbs={images.length > 1}
              infiniteLoop
              preventMovementUntilSwipeScrollTolerance
              swipeScrollTolerance={50}
              selectedItem={currentSlide}
              onChange={(index) => setCurrentSlide(index)}
              onClickItem={(index) => {
                setCurrentSlide(index);
                return false;
              }}
              renderArrowPrev={(onClickHandler, hasPrev, label) =>
                hasPrev && (
                  <button
                    type="button"
                    className={`left-4 ${PREVNEXTBUTTONSTYLES}`}
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      onClickHandler();
                    }}
                    title={label}
                  >
                    <ChevronLeftIcon className="h-6 w-6 text-black dark:text-white" />
                  </button>
                )
              }
              renderArrowNext={(onClickHandler, hasNext, label) =>
                hasNext && (
                  <button
                    type="button"
                    className={`right-4 ${PREVNEXTBUTTONSTYLES}`}
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      onClickHandler();
                    }}
                    title={label}
                  >
                    <ChevronRightIcon className="h-6 w-6 text-black dark:text-white" />
                  </button>
                )
              }
              renderIndicator={(onClickHandler, isSelected, index, label) => {
                const base =
                  "inline-block w-3 h-3 rounded-full mx-1 cursor-pointer";
                return (
                  <li
                    key={index}
                    className={
                      isSelected
                        ? `${base} bg-blue-500`
                        : `${base} bg-gray-300 hover:bg-gray-500`
                    }
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      onClickHandler(e);
                    }}
                    title={`${label} ${index + 1}`}
                    role="button"
                    tabIndex={0}
                    style={{ marginBottom: "10px" }}
                  />
                );
              }}
            >
              {images.length > 0
                ? images.map((image, index) => (
                    <div
                      key={index}
                      className="relative flex h-full w-full items-center justify-center p-4"
                      onClick={(e) => e.preventDefault()}
                    >
                      <div className="absolute top-4 right-4 z-20">
                        {" "}
                        {/* Increased spacing */}
                        <ConfirmActionDropdown
                          helpText="Are you sure you want to delete this image?"
                          buttonLabel="Delete Image"
                          onConfirm={deleteImage(index)}
                        >
                          <Button
                            type="button"
                            isIconOnly
                            color="danger"
                            aria-label="Trash"
                            radius="full"
                            className="bg-gradient-to-tr from-blue-950 to-red-950 text-white"
                            variant="bordered"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <TrashIcon style={{ padding: 4 }} />
                          </Button>
                        </ConfirmActionDropdown>
                      </div>
                      <Image
                        alt="Product Image"
                        className="object-cover"
                        width={350}
                        src={image}
                        srcSet={buildSrcSet(image)}
                        onClick={(e) => e.preventDefault()} // Prevent form submission
                      />
                    </div>
                  ))
                : [
                    <div
                      key="placeholder"
                      className="flex h-full w-full items-center justify-center p-4"
                    >
                      <FileUploaderButton
                        isPlaceholder={true}
                        isProductUpload={true}
                        imgCallbackOnUpload={(imgUrl) => {
                          if (imgUrl && imgUrl.length > 0) {
                            setImageError(null);
                            setImages((prevValues) => [...prevValues, imgUrl]);
                          }
                        }}
                      >
                        Upload Images
                      </FileUploaderButton>
                    </div>,
                  ]}
            </Carousel>
            {imageError && <div className="text-red-600">{imageError}</div>}
            <FileUploaderButton
              isProductUpload={true}
              className={SHOPSTRBUTTONCLASSNAMES}
              imgCallbackOnUpload={(imgUrl) => {
                if (imgUrl && imgUrl.length > 0) {
                  setImageError(null);
                  setImages((prevValues) => [...prevValues, imgUrl]);
                }
              }}
            >
              Upload Images
            </FileUploaderButton>
            <Controller
              name="Description"
              control={control}
              rules={{
                required: "A description is required.",
              }}
              render={({
                field: { onChange, onBlur, value },
                fieldState: { error },
              }) => {
                const isErrored = error !== undefined;
                const errorMessage: string = error?.message
                  ? error.message
                  : "";
                return (
                  <Textarea
                    className="text-light-text dark:text-dark-text"
                    variant="bordered"
                    fullWidth={true}
                    label="Description"
                    labelPlacement="inside"
                    isInvalid={isErrored}
                    errorMessage={errorMessage}
                    // controller props
                    onChange={onChange} // send value to hook form
                    onBlur={onBlur} // notify when input is touched/blur
                    value={value}
                  />
                );
              }}
            />

            <Controller
              name="Price"
              control={control}
              rules={{
                required: "A price is required.",
                min: { value: 0, message: "Price must be greater than 0" },
              }}
              render={({
                field: { onChange, onBlur, value },
                fieldState: { error },
              }) => {
                const isErrored = error !== undefined;
                const errorMessage: string = error?.message
                  ? error.message
                  : "";
                return (
                  <Input
                    className="text-light-text dark:text-dark-text"
                    type="number"
                    variant="flat"
                    label="Price"
                    labelPlacement="inside"
                    isInvalid={isErrored}
                    errorMessage={errorMessage}
                    // controller props
                    onChange={onChange} // send value to hook form
                    onBlur={onBlur} // notify when input is touched/blur
                    value={value}
                    endContent={
                      <Controller
                        control={control}
                        name="Currency"
                        rules={{
                          required: "Please specify a currency.",
                        }}
                        render={({ field: { onChange, onBlur, value } }) => {
                          return (
                            <div className="flex items-center">
                              <select
                                className="text-small text-default-400 border-0 bg-transparent outline-none"
                                key={"currency"}
                                id="currency"
                                name="currency"
                                onChange={onChange} // send value to hook form
                                onBlur={onBlur} // notify when input is touched/blur
                                value={value}
                              >
                                {currencyOptions.map((currency) => (
                                  <option
                                    key={currency.value}
                                    value={currency.value}
                                  >
                                    {currency.value}
                                  </option>
                                ))}
                              </select>
                            </div>
                          );
                        }}
                      />
                    }
                  />
                );
              }}
            />

            <div className="mx-4 my-2 flex items-center justify-center text-center">
              <InformationCircleIcon className="text-light-text dark:text-dark-text h-6 w-6" />
              <p className="text-light-text dark:text-dark-text ml-2 text-xs">
                Your donation rate on sales is set to{" "}
                {profileContext.profileData.get(pubkey)?.content
                  ?.shopstr_donation || 2.1}
                %. You can modify this in your{" "}
                <span
                  className="cursor-pointer underline hover:text-purple-500 dark:hover:text-yellow-500"
                  onClick={() => router.push("/settings/user-profile")}
                >
                  profile settings
                </span>
                .
              </p>
            </div>

            <Controller
              name="Location"
              control={control}
              rules={{
                required: "Please specify a location.",
              }}
              render={({
                field: { onChange, onBlur, value },
                fieldState: { error },
              }) => {
                const isErrored = error !== undefined;
                const errorMessage: string = error?.message
                  ? error.message
                  : "";
                return (
                  <LocationDropdown
                    variant="bordered"
                    aria-label="Select Location"
                    label="Location"
                    labelPlacement="inside"
                    isInvalid={isErrored}
                    errorMessage={errorMessage}
                    // controller props
                    onChange={onChange} // send value to hook form
                    onBlur={onBlur} // notify when input is touched/blur
                    value={value}
                  />
                );
              }}
            />

            <Controller
              name="Shipping Option"
              control={control}
              rules={{
                required: "Please specify a shipping option.",
              }}
              render={({
                field: { onChange, onBlur, value },
                fieldState: { error },
              }) => {
                const isErrored = error !== undefined;
                const errorMessage: string = error?.message
                  ? error.message
                  : "";
                return (
                  <Select
                    className="text-light-text dark:text-dark-text"
                    variant="bordered"
                    aria-label="Shipping Option"
                    label="Shipping option"
                    labelPlacement="inside"
                    isInvalid={isErrored}
                    errorMessage={errorMessage}
                    disallowEmptySelection={true}
                    // controller props
                    onChange={onChange} // send value to hook form
                    onBlur={onBlur} // notify when input is touched/blur
                    selectedKeys={[value as string]}
                  >
                    <SelectSection className="text-light-text dark:text-dark-text">
                      {SHIPPING_OPTIONS.map((option) => (
                        <SelectItem key={option}>{option}</SelectItem>
                      ))}
                    </SelectSection>
                  </Select>
                );
              }}
            />

            {watchShippingOption === "Added Cost" && (
              <Controller
                name="Shipping Cost"
                control={control}
                rules={{
                  required: "A Shipping Cost is required.",
                  min: {
                    value: 0,
                    message: "Shipping Cost must be greater than 0",
                  },
                }}
                render={({
                  field: { onChange, onBlur, value },
                  fieldState: { error },
                }) => {
                  const isErrored = error !== undefined;
                  const errorMessage: string = error?.message
                    ? error.message
                    : "";
                  return (
                    <Input
                      type="number"
                      autoFocus
                      variant="flat"
                      placeholder="Shipping Cost"
                      isInvalid={isErrored}
                      errorMessage={errorMessage}
                      // controller props
                      onChange={onChange} // send value to hook form
                      onBlur={onBlur} // notify when input is touched/blur
                      value={value?.toString()}
                      endContent={
                        <div className="flex items-center">
                          <select
                            className="text-small text-default-400 border-0 bg-transparent outline-none"
                            key={"currency"}
                            id="currency"
                            name="currency"
                            value={watchCurrency}
                            disabled={true}
                          >
                            {currencyOptions.map((currency) => (
                              <option
                                key={currency.value}
                                value={currency.value}
                              >
                                {currency.value}
                              </option>
                            ))}
                          </select>
                        </div>
                      }
                    />
                  );
                }}
              />
            )}

            {(watchShippingOption === "Pickup" ||
              watchShippingOption === "Free/Pickup") && (
              <div className="space-y-4">
                <h3 className="text-light-text dark:text-dark-text text-lg font-semibold">
                  Pickup Locations
                </h3>
                <p className="text-sm text-gray-600 dark:text-gray-400">
                  Add one or more pickup locations where customers can collect
                  their orders (if applicable).
                </p>

                <Controller
                  name="Pickup Locations"
                  control={control}
                  defaultValue={[""]}
                  render={({ field: { onChange, value = [""] } }) => (
                    <div className="space-y-3">
                      {value.map((location: string, index: number) => (
                        <div key={index} className="flex items-center gap-2">
                          <Input
                            className="text-light-text dark:text-dark-text flex-1"
                            variant="bordered"
                            placeholder={`Pickup location ${
                              index + 1
                            } (e.g., 123 Main St, City, State)`}
                            value={location}
                            onChange={(e) => {
                              const newLocations = [...value];
                              newLocations[index] = e.target.value;
                              onChange(newLocations);
                            }}
                            label={`Pickup Location ${index + 1}`}
                            labelPlacement="inside"
                          />
                          {value.length > 1 && (
                            <Button
                              isIconOnly
                              color="danger"
                              variant="light"
                              onClick={() => {
                                const newLocations = value.filter(
                                  (_: string, i: number) => i !== index
                                );
                                onChange(newLocations);
                              }}
                            >
                              <TrashIcon className="h-4 w-4" />
                            </Button>
                          )}
                        </div>
                      ))}

                      {theme === "dark" ? (
                        <Button
                          variant="bordered"
                          color="warning"
                          className="w-full"
                          onClick={() => {
                            const newLocations = [...value, ""];
                            onChange(newLocations);
                          }}
                        >
                          Add Another Pickup Location
                        </Button>
                      ) : (
                        <Button
                          variant="bordered"
                          color="secondary"
                          className="w-full"
                          onClick={() => {
                            const newLocations = [...value, ""];
                            onChange(newLocations);
                          }}
                        >
                          Add Another Pickup Location
                        </Button>
                      )}
                    </div>
                  )}
                />
              </div>
            )}
            <Controller
              name="Category"
              control={control}
              rules={{
                required: "A category is required.",
              }}
              render={({
                field: { onChange, onBlur, value },
                fieldState: { error },
              }) => {
                const isErrored = error !== undefined;
                const errorMessage: string = error?.message
                  ? error.message
                  : "";
                return (
                  <Select
                    variant="bordered"
                    isMultiline={true}
                    aria-label="Category"
                    label="Categories"
                    labelPlacement="inside"
                    selectionMode="multiple"
                    isInvalid={isErrored}
                    errorMessage={errorMessage}
                    // controller props
                    onChange={onChange} // send value to hook form
                    onBlur={onBlur} // notify when input is touched/blur
                    value={value}
                    defaultSelectedKeys={value ? value.split(",") : ""}
                    classNames={{
                      base: "mt-4",
                      trigger: "min-h-unit-12 py-2",
                    }}
                    renderValue={(items) => {
                      return (
                        <div className="flex flex-wrap gap-2">
                          {items.map((item) => (
                            <Chip key={item.key}>
                              {item.key
                                ? (item.key as string)
                                : "unknown category"}
                            </Chip>
                          ))}
                        </div>
                      );
                    }}
                  >
                    <SelectSection className="text-light-text dark:text-dark-text">
                      {CATEGORIES.map((category) => (
                        <SelectItem key={category}>{category}</SelectItem>
                      ))}
                    </SelectSection>
                  </Select>
                );
              }}
            />

            <Controller
              name="Bulk Pricing Enabled"
              control={control}
              render={({ field: { onChange, value } }) => (
                <div className="mt-4 flex items-center justify-between rounded-lg border border-gray-200 p-3 dark:border-gray-700">
                  <div className="flex flex-col">
                    <span className="text-light-text dark:text-dark-text text-sm font-semibold">
                      Bulk/Bundle Pricing
                    </span>
                    <span className="text-tiny text-gray-500">
                      Offer discounted pricing for multiple units
                    </span>
                  </div>
                  <Switch
                    isSelected={!!value}
                    onValueChange={onChange}
                    classNames={{
                      wrapper:
                        "group-data-[selected=true]:bg-shopstr-purple dark:group-data-[selected=true]:bg-shopstr-yellow",
                    }}
                  />
                </div>
              )}
            />

            <Controller
              name="Bulk Prices"
              control={control}
              render={({
                field: { onChange, value = new Map<number, number>() },
              }) => {
                const bulkEnabled = watch("Bulk Pricing Enabled");
                if (!bulkEnabled) return <></>;

                const handleAddTier = () => {
                  const newPrices = new Map(value);
                  newPrices.set(0, 0);
                  onChange(newPrices);
                };

                const handleRemoveTier = (units: number) => {
                  const newPrices = new Map(value);
                  newPrices.delete(units);
                  onChange(newPrices);
                };

                const handleUnitsChange = (
                  oldUnits: number,
                  newUnits: number
                ) => {
                  const newPrices = new Map<number, number>();
                  value.forEach((price: number, units: number) => {
                    if (units === oldUnits) {
                      newPrices.set(newUnits, price);
                    } else {
                      newPrices.set(units, price);
                    }
                  });
                  onChange(newPrices);
                };

                const handlePriceChange = (units: number, price: number) => {
                  const newPrices = new Map(value);
                  newPrices.set(units, price);
                  onChange(newPrices);
                };

                const entries = Array.from(value.entries()).sort(
                  (a: [number, number], b: [number, number]) => a[0] - b[0]
                );

                return (
                  <div className="mt-2 space-y-3">
                    <p className="text-sm text-gray-600 dark:text-gray-400">
                      Set prices for different unit quantities. These prices
                      override the single-unit price.
                    </p>
                    {entries.map(
                      ([units, price]: [number, number], index: number) => (
                        <div key={index} className="flex items-center gap-2">
                          <Input
                            type="number"
                            min="1"
                            label="Units"
                            labelPlacement="inside"
                            value={units > 0 ? units.toString() : ""}
                            onChange={(e) =>
                              handleUnitsChange(
                                units,
                                parseInt(e.target.value) || 0
                              )
                            }
                            className="w-24"
                          />
                          <Input
                            type="number"
                            step="0.01"
                            min="0"
                            label="Total Price"
                            labelPlacement="inside"
                            value={price > 0 ? price.toString() : ""}
                            onChange={(e) =>
                              handlePriceChange(
                                units,
                                parseFloat(e.target.value) || 0
                              )
                            }
                            className="flex-1"
                            endContent={
                              <span className="text-small text-default-400">
                                {watchCurrency}
                              </span>
                            }
                          />
                          <Button
                            isIconOnly
                            color="danger"
                            variant="light"
                            onClick={() => handleRemoveTier(units)}
                          >
                            <TrashIcon className="h-4 w-4" />
                          </Button>
                        </div>
                      )
                    )}
                    {theme === "dark" ? (
                      <Button
                        variant="bordered"
                        color="warning"
                        className="w-full"
                        onClick={handleAddTier}
                      >
                        Add Bulk Tier
                      </Button>
                    ) : (
                      <Button
                        variant="bordered"
                        color="secondary"
                        className="w-full"
                        onClick={handleAddTier}
                      >
                        Add Bulk Tier
                      </Button>
                    )}
                    {entries.length > 0 && (
                      <div className="text-light-text dark:text-dark-text w-full text-xs opacity-75">
                        Note: Bulk prices override the single-unit price when a
                        buyer selects a bundle option.
                      </div>
                    )}
                  </div>
                );
              }}
            />

            {/* --- Flash Sale Toggle --- */}
            <div className="mt-4 flex items-center justify-between rounded-lg border border-gray-200 p-3 dark:border-gray-700">
              <div className="flex flex-col">
                <span className="text-light-text dark:text-dark-text text-sm font-semibold">
                  Post as Flash Sale
                </span>
                <span className="text-tiny text-gray-500">
                  Also broadcast to Global Feed (Nostr)
                </span>
              </div>
              <Switch
                isSelected={isFlashSale}
                onValueChange={setIsFlashSale}
                classNames={{
                  wrapper:
                    "group-data-[selected=true]:bg-shopstr-purple dark:group-data-[selected=true]:bg-shopstr-yellow",
                }}
              />
            </div>

            <div className="w-full max-w-xs">
              <Button
                className="text-shopstr-purple-light dark:text-shopstr-yellow-light mt-4 mb-2 w-full justify-start rounded-md pl-2"
                variant="light"
                onClick={() => setShowOptionalTags(!showOptionalTags)}
              >
                <div className="flex items-center py-2">
                  <span>Additional options</span>
                  <span className="ml-2">{showOptionalTags ? "↑" : "↓"}</span>
                </div>
              </Button>
            </div>

            {showOptionalTags && (
              <>
                <Controller
                  name="Quantity"
                  control={control}
                  rules={{
                    min: { value: 1, message: "Quantity must be at least 1" },
                  }}
                  render={({
                    field: { onChange, value },
                    fieldState: { error },
                  }) => {
                    const isErrored = error !== undefined;
                    const errorMessage = error?.message || "";
                    return (
                      <div className="flex flex-col">
                        <Input
                          variant="flat"
                          autoFocus
                          type="number"
                          min="1"
                          aria-label="Quantity"
                          label="Quantity"
                          labelPlacement="inside"
                          value={value}
                          onChange={(e) =>
                            onChange(parseInt(e.target.value) || 1)
                          }
                          className="w-20"
                          isInvalid={isErrored}
                          errorMessage={errorMessage}
                        />
                      </div>
                    );
                  }}
                />

                <Controller
                  name="Sizes"
                  control={control}
                  render={({
                    field: { onChange, onBlur, value },
                    fieldState: { error },
                  }) => {
                    const isErrored = error !== undefined;
                    const errorMessage = error?.message || "";

                    const selectedSizes = Array.isArray(value)
                      ? value
                      : typeof value === "string"
                        ? value.split(",").filter(Boolean)
                        : [];

                    const handleSizeChange = (newValue: string | string[]) => {
                      const newSizes = Array.isArray(newValue)
                        ? newValue
                        : newValue.split(",").filter(Boolean);
                      onChange(newSizes);
                    };

                    return (
                      <Select
                        variant="bordered"
                        isMultiline={true}
                        autoFocus
                        aria-label="Sizes"
                        label="Sizes"
                        labelPlacement="inside"
                        selectionMode="multiple"
                        isInvalid={isErrored}
                        errorMessage={errorMessage}
                        onChange={(e) => handleSizeChange(e.target.value)}
                        onBlur={onBlur}
                        value={selectedSizes}
                        defaultSelectedKeys={new Set(selectedSizes)}
                        classNames={{
                          base: "mt-4",
                          trigger: "min-h-unit-12 py-2",
                        }}
                      >
                        <SelectSection className="text-light-text dark:text-dark-text">
                          <SelectItem key="XS">XS</SelectItem>
                          <SelectItem key="SM">SM</SelectItem>
                          <SelectItem key="MD">MD</SelectItem>
                          <SelectItem key="LG">LG</SelectItem>
                          <SelectItem key="XL">XL</SelectItem>
                          <SelectItem key="XXL">XXL</SelectItem>
                        </SelectSection>
                      </Select>
                    );
                  }}
                />

                <Controller
                  name="Volumes"
                  control={control}
                  render={({
                    field: { onChange, onBlur, value },
                    fieldState: { error },
                  }) => {
                    const isErrored = error !== undefined;
                    const errorMessage = error?.message || "";

                    const selectedVolumes = Array.isArray(value)
                      ? value
                      : typeof value === "string"
                        ? value.split(",").filter(Boolean)
                        : [];

                    const handleVolumeChange = (
                      newValue: string | string[]
                    ) => {
                      const newVolumes = Array.isArray(newValue)
                        ? newValue
                        : newValue.split(",").filter(Boolean);
                      onChange(newVolumes);
                    };

                    return (
                      <Select
                        variant="bordered"
                        isMultiline={true}
                        autoFocus
                        aria-label="Volumes"
                        label="Volumes"
                        labelPlacement="inside"
                        selectionMode="multiple"
                        isInvalid={isErrored}
                        errorMessage={errorMessage}
                        onChange={(e) => handleVolumeChange(e.target.value)}
                        onBlur={onBlur}
                        value={selectedVolumes}
                        defaultSelectedKeys={new Set(selectedVolumes)}
                        classNames={{
                          base: "mt-4",
                          trigger: "min-h-unit-12 py-2",
                        }}
                      >
                        <SelectSection className="text-light-text dark:text-dark-text">
                          <SelectItem key="Half-pint">Half-pint</SelectItem>
                          <SelectItem key="Pint">Pint</SelectItem>
                          <SelectItem key="Quart">Quart</SelectItem>
                          <SelectItem key="Half-gallon">Half-gallon</SelectItem>
                          <SelectItem key="Gallon">Gallon</SelectItem>
                        </SelectSection>
                      </Select>
                    );
                  }}
                />

                <Controller
                  name="Volume Prices"
                  control={control}
                  render={({
                    field: { onChange, value = new Map<string, number>() },
                  }) => {
                    const handlePriceChange = (
                      volume: string,
                      price: number
                    ) => {
                      const newPrices = new Map(value);
                      newPrices.set(volume, price);
                      onChange(newPrices);
                    };

                    const volumes = watch("Volumes");
                    const volumeArray = Array.isArray(volumes)
                      ? volumes
                      : typeof volumes === "string"
                        ? volumes
                            .split(",")
                            .filter(Boolean)
                            .map((v) => v.trim())
                        : [];

                    return (
                      <div className="mt-4 flex flex-wrap gap-4">
                        {volumeArray.map((volume: string) => (
                          <div key={volume} className="flex items-center">
                            <span className="text-light-text dark:text-dark-text mr-2">
                              {volume}:
                            </span>
                            <Input
                              type="number"
                              step="0.01"
                              min="0"
                              value={(value.get(volume) || 0).toString()}
                              onChange={(e) =>
                                handlePriceChange(
                                  volume,
                                  parseFloat(e.target.value) || 0
                                )
                              }
                              className="w-32"
                              endContent={
                                <div className="flex items-center">
                                  <span className="text-small text-default-400">
                                    {watchCurrency}
                                  </span>
                                </div>
                              }
                            />
                          </div>
                        ))}
                        {volumeArray.length > 0 && (
                          <div className="text-light-text dark:text-dark-text w-full text-xs opacity-75">
                            Note: Volume prices will override the main product
                            price when selected.
                          </div>
                        )}
                      </div>
                    );
                  }}
                />

                <Controller
                  name="Weights"
                  control={control}
                  render={({
                    field: { onChange, onBlur, value },
                    fieldState: { error },
                  }) => {
                    const isErrored = error !== undefined;
                    const errorMessage = error?.message || "";

                    const selectedWeights = Array.isArray(value)
                      ? value
                      : typeof value === "string"
                        ? value.split(",").filter(Boolean)
                        : [];

                    const handleWeightChange = (
                      newValue: string | string[]
                    ) => {
                      const newWeights = Array.isArray(newValue)
                        ? newValue
                        : newValue.split(",").filter(Boolean);
                      onChange(newWeights);
                    };

                    return (
                      <Select
                        variant="bordered"
                        isMultiline={true}
                        autoFocus
                        aria-label="Weights"
                        label="Weights"
                        labelPlacement="inside"
                        selectionMode="multiple"
                        isInvalid={isErrored}
                        errorMessage={errorMessage}
                        onChange={(e) => handleWeightChange(e.target.value)}
                        onBlur={onBlur}
                        value={selectedWeights}
                        defaultSelectedKeys={new Set(selectedWeights)}
                        classNames={{
                          base: "mt-4",
                          trigger: "min-h-unit-12 py-2",
                        }}
                      >
                        <SelectSection className="text-light-text dark:text-dark-text">
                          <SelectItem key="1 oz">1 oz</SelectItem>
                          <SelectItem key="2 oz">2 oz</SelectItem>
                          <SelectItem key="4 oz">4 oz</SelectItem>
                          <SelectItem key="8 oz">8 oz</SelectItem>
                          <SelectItem key="12 oz">12 oz</SelectItem>
                          <SelectItem key="1 lb">1 lb</SelectItem>
                          <SelectItem key="2 lb">2 lb</SelectItem>
                          <SelectItem key="5 lb">5 lb</SelectItem>
                          <SelectItem key="10 lb">10 lb</SelectItem>
                          <SelectItem key="25 lb">25 lb</SelectItem>
                        </SelectSection>
                      </Select>
                    );
                  }}
                />

                <Controller
                  name="Weight Prices"
                  control={control}
                  render={({
                    field: { onChange, value = new Map<string, number>() },
                  }) => {
                    const handlePriceChange = (
                      weight: string,
                      price: number
                    ) => {
                      const newPrices = new Map(value);
                      newPrices.set(weight, price);
                      onChange(newPrices);
                    };

                    const weights = watch("Weights");
                    const weightArray = Array.isArray(weights)
                      ? weights
                      : typeof weights === "string"
                        ? weights
                            .split(",")
                            .filter(Boolean)
                            .map((w) => w.trim())
                        : [];

                    return (
                      <div className="mt-4 flex flex-wrap gap-4">
                        {weightArray.map((weight: string) => (
                          <div key={weight} className="flex items-center">
                            <span className="text-light-text dark:text-dark-text mr-2">
                              {weight}:
                            </span>
                            <Input
                              type="number"
                              step="0.01"
                              min="0"
                              value={(value.get(weight) || 0).toString()}
                              onChange={(e) =>
                                handlePriceChange(
                                  weight,
                                  parseFloat(e.target.value) || 0
                                )
                              }
                              className="w-32"
                              endContent={
                                <div className="flex items-center">
                                  <span className="text-small text-default-400">
                                    {watchCurrency}
                                  </span>
                                </div>
                              }
                            />
                          </div>
                        ))}
                        {weightArray.length > 0 && (
                          <div className="text-light-text dark:text-dark-text w-full text-xs opacity-75">
                            Note: Weight prices will override the main product
                            price when selected.
                          </div>
                        )}
                      </div>
                    );
                  }}
                />

                <Controller
                  name="Size Quantities"
                  control={control}
                  render={({
                    field: { onChange, value = new Map<string, number>() },
                  }) => {
                    const handleQuantityChange = (
                      size: string,
                      quantity: number
                    ) => {
                      const newQuantities = new Map(value);
                      newQuantities.set(size, quantity);
                      onChange(newQuantities);
                    };

                    const sizes = watch("Sizes");
                    const sizeArray = Array.isArray(sizes)
                      ? sizes
                      : sizes?.split(",").filter(Boolean) || [];

                    return (
                      <div className="mt-4 flex flex-wrap gap-4">
                        {sizeArray.map((size: string) => (
                          <div key={size} className="flex items-center">
                            <span className="text-light-text dark:text-dark-text mr-2">
                              {size}:
                            </span>
                            <Input
                              type="number"
                              min="0"
                              value={(value.get(size) || 0).toString()}
                              onChange={(e) =>
                                handleQuantityChange(
                                  size,
                                  parseInt(e.target.value) || 0
                                )
                              }
                              className="w-20"
                            />
                          </div>
                        ))}
                      </div>
                    );
                  }}
                />

                <Controller
                  name="Condition"
                  control={control}
                  render={({
                    field: { onChange, onBlur, value },
                    fieldState: { error },
                  }) => {
                    const isErrored = error !== undefined;
                    const errorMessage: string = error?.message
                      ? error.message
                      : "";
                    return (
                      <Select
                        className="text-light-text dark:text-dark-text"
                        autoFocus
                        variant="bordered"
                        aria-label="Condition"
                        label="Condition"
                        labelPlacement="inside"
                        isInvalid={isErrored}
                        errorMessage={errorMessage}
                        disallowEmptySelection={true}
                        // controller props
                        onChange={onChange} // send value to hook form
                        onBlur={onBlur} // notify when input is touched/blur
                        selectedKeys={[value as string]}
                      >
                        <SelectSection className="text-light-text dark:text-dark-text">
                          <SelectItem key="New">New</SelectItem>
                          <SelectItem key="Renewed">Renewed</SelectItem>
                          <SelectItem key="Used - Like New">
                            Used - Like New
                          </SelectItem>
                          <SelectItem key="Used - Very Good">
                            Used - Very Good
                          </SelectItem>
                          <SelectItem key="Used - Good">Used - Good</SelectItem>
                          <SelectItem key="Used - Acceptable">
                            Used - Acceptable
                          </SelectItem>
                        </SelectSection>
                      </Select>
                    );
                  }}
                />

                <Controller
                  name="Status"
                  control={control}
                  render={({
                    field: { onChange, onBlur, value },
                    fieldState: { error },
                  }) => {
                    const isErrored = error !== undefined;
                    const errorMessage: string = error?.message
                      ? error.message
                      : "";
                    return (
                      <Select
                        className="text-light-text dark:text-dark-text"
                        autoFocus
                        variant="bordered"
                        aria-label="Status"
                        label="Status"
                        labelPlacement="inside"
                        isInvalid={isErrored}
                        errorMessage={errorMessage}
                        disallowEmptySelection={true}
                        // controller props
                        onChange={onChange} // send value to hook form
                        onBlur={onBlur} // notify when input is touched/blur
                        selectedKeys={[value as string]}
                      >
                        <SelectSection className="text-light-text dark:text-dark-text">
                          <SelectItem key="active">Active</SelectItem>
                          <SelectItem key="sold">Sold</SelectItem>
                        </SelectSection>
                      </Select>
                    );
                  }}
                />

                <Controller
                  name="Required"
                  control={control}
                  render={({
                    field: { onChange, onBlur, value },
                    fieldState: { error },
                  }) => {
                    const isErrored = error !== undefined;
                    const errorMessage: string = error?.message
                      ? error.message
                      : "";
                    return (
                      <Input
                        className="text-light-text dark:text-dark-text"
                        autoFocus
                        variant="bordered"
                        placeholder="Email, phone number, etc."
                        fullWidth={true}
                        label="Required Customer Information"
                        labelPlacement="inside"
                        isInvalid={isErrored}
                        errorMessage={errorMessage}
                        // controller props
                        onChange={onChange} // send value to hook form
                        onBlur={onBlur} // notify when input is touched/blur
                        value={value}
                      />
                    );
                  }}
                />

                <Controller
                  name="Restrictions"
                  control={control}
                  render={({
                    field: { onChange, onBlur, value },
                    fieldState: { error },
                  }) => {
                    const isErrored = error !== undefined;
                    const errorMessage: string = error?.message
                      ? error.message
                      : "";
                    return (
                      <Input
                        className="text-light-text dark:text-dark-text"
                        autoFocus
                        variant="bordered"
                        placeholder="US shipping only, signature required, no P.O. box delivery, etc."
                        fullWidth={true}
                        label="Restrictions"
                        labelPlacement="inside"
                        isInvalid={isErrored}
                        errorMessage={errorMessage}
                        // controller props
                        onChange={onChange} // send value to hook form
                        onBlur={onBlur} // notify when input is touched/blur
                        value={value}
                      />
                    );
                  }}
                />
              </>
            )}

            {showOptionalTags && (
              <Controller
                name="Expiration"
                control={control}
                render={({
                  field: { onChange, onBlur, value },
                  fieldState: { error },
                }) => {
                  const isErrored = error !== undefined;
                  const errorMessage = error?.message || "";
                  return (
                    <div className="mt-4">
                      <Input
                        type="datetime-local"
                        min={formatCurrentDateTimeLocalValue()}
                        variant="bordered"
                        label="Valid Until (Optional)"
                        labelPlacement="inside"
                        placeholder="Select a date to mark listing as stale"
                        isInvalid={isErrored}
                        errorMessage={errorMessage}
                        onChange={onChange}
                        onBlur={onBlur}
                        value={value as string}
                        className="text-light-text dark:text-dark-text"
                      />
                      <p className="text-tiny mt-1 text-gray-500">
                        Listing will remain visible but marked as
                        &quot;Outdated&quot; after this date. Leave empty if
                        product has no expiration. Buyers won&apos;t be able to
                        purchase after expiration.
                      </p>
                    </div>
                  );
                }}
              />
            )}

            <div className="mx-4 my-2 flex items-center justify-center text-center">
              <InformationCircleIcon className="text-light-text dark:text-dark-text h-6 w-6" />
              <p className="text-light-text dark:text-dark-text ml-2 text-xs">
                Your payment preference is set to{" "}
                {profileContext.profileData.get(pubkey)?.content
                  ?.payment_preference === "lightning"
                  ? "Lightning"
                  : "Cashu"}
                . You can modify this in your{" "}
                <span
                  className="cursor-pointer underline hover:text-purple-500 dark:hover:text-yellow-500"
                  onClick={() => router.push("/settings/user-profile")}
                >
                  profile settings
                </span>
                .
              </p>
            </div>
          </ModalBody>

          <ModalFooter>
            <ConfirmActionDropdown
              helpText={
                "Are you sure you want to clear this form? You will lose all current progress."
              }
              buttonLabel={"Clear Form"}
              onConfirm={clear}
            >
              <Button color="danger" variant="light">
                Clear
              </Button>
            </ConfirmActionDropdown>

            <Button
              className={SHOPSTRBUTTONCLASSNAMES}
              type="submit"
              onClick={(e) => {
                if (signer && isLoggedIn) {
                  e.preventDefault();
                  handleSubmit(onSubmit as any)();
                }
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault(); // Prevent default to avoid submitting the form again
                  handleSubmit(onSubmit as any)(); // Programmatic submit
                }
              }}
              isDisabled={isPostingOrUpdatingProduct}
              isLoading={isPostingOrUpdatingProduct}
            >
              {isEdit ? "Edit Product" : "List Product"}
            </Button>
          </ModalFooter>
        </form>
      </ModalContent>
    </Modal>
  );
}
