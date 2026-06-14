import React from "react";
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import DisplayProductModal from "../display-product-modal";
import { ProductContext } from "@/utils/context/context";
import { SignerContext } from "@/components/utility-components/nostr-context-provider";
import { ProductData } from "@/utils/parsers/product-parser-functions";

jest.mock("@heroui/react", () => ({
  Modal: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  ModalContent: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  ModalHeader: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  ModalBody: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  ModalFooter: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  Button: ({
    children,
    startContent,
    onClick,
  }: {
    children: React.ReactNode;
    startContent?: React.ReactNode;
    onClick?: () => void;
  }) => (
    <button type="button" onClick={onClick}>
      {startContent}
      {children}
    </button>
  ),
  Chip: ({
    children,
    startContent,
  }: {
    children: React.ReactNode;
    startContent?: React.ReactNode;
  }) => (
    <div>
      {startContent}
      {children}
    </div>
  ),
  Divider: () => <hr />,
}));

jest.mock("@heroicons/react/24/outline", () => ({
  PencilSquareIcon: () => <svg />,
  ShareIcon: () => <svg />,
  TrashIcon: () => <svg />,
}));

jest.mock("../product-form", () => () => null);
jest.mock("../utility-components/image-carousel", () => () => (
  <div data-testid="image-carousel" />
));
jest.mock("../utility-components/compact-categories", () => () => (
  <div data-testid="compact-categories" />
));
jest.mock("../utility-components/dropdowns/location-dropdown", () => ({
  locationAvatar: () => null,
}));
jest.mock("../utility-components/dropdowns/confirm-action-dropdown", () => ({
  __esModule: true,
  default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
jest.mock("../utility-components/profile/profile-dropdown", () => ({
  ProfileWithDropdown: () => <div data-testid="profile-dropdown" />,
}));
jest.mock("../utility-components/success-modal", () => () => null);
jest.mock("../utility-components/taxonomy-summary", () => ({
  __esModule: true,
  default: ({ productData }: { productData: ProductData }) => (
    <div data-testid="taxonomy-summary">{productData.title} taxonomy</div>
  ),
}));

const baseProduct: ProductData = {
  id: "product-id",
  pubkey: "seller-pubkey",
  title: "Taxonomy Listing",
  summary: "Listing summary",
  images: ["https://example.com/image.png"],
  categories: ["collectibles"],
  location: "Online",
  price: 100,
  currency: "SATS",
  shippingType: "Free",
  status: "active",
  createdAt: 1710000000,
  publishedAt: "",
  totalCost: 100,
};

function renderModal(productData: ProductData) {
  return render(
    <SignerContext.Provider
      value={{ pubkey: "viewer-pubkey", isLoggedIn: true } as any}
    >
      <ProductContext.Provider
        value={{
          productEvents: [],
          isLoading: false,
          addNewlyCreatedProductEvent: jest.fn(),
          removeDeletedProductEvent: jest.fn(),
        }}
      >
        <DisplayProductModal
          productData={productData}
          showModal
          handleModalToggle={jest.fn()}
          handleDelete={jest.fn()}
        />
      </ProductContext.Provider>
    </SignerContext.Provider>
  );
}

describe("DisplayProductModal taxonomy details", () => {
  it("renders taxonomy summary before the standard summary for taxonomy-tagged products", () => {
    renderModal({
      ...baseProduct,
      taxonomy: {
        primaryThingRef: "thing:artifact:trading_card",
        overlayValRefs: ["val:context:segment:memorabilia"],
        requiredRefs: [],
        refAssertions: [
          {
            propRef: "prop:condition",
            valueRef: "val:condition:trading_card:mint",
          },
        ],
        literalAssertions: [],
      },
    });

    expect(screen.getByTestId("taxonomy-summary")).toHaveTextContent(
      "Taxonomy Listing taxonomy"
    );
    expect(screen.getByText("Summary:")).toBeInTheDocument();
  });

  it("does not render taxonomy summary for products without taxonomy assertions", () => {
    renderModal(baseProduct);

    expect(screen.queryByTestId("taxonomy-summary")).not.toBeInTheDocument();
    expect(screen.getByText("Summary:")).toBeInTheDocument();
  });
});
