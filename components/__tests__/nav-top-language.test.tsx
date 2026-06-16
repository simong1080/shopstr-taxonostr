import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import TopNav from "@/components/nav-top";
import {
  ChatsContext,
  ShopMapContext,
  SiteLanguageContext,
} from "@/utils/context/context";
import { SignerContext } from "@/components/utility-components/nostr-context-provider";

const push = jest.fn();

jest.mock("next/router", () => ({
  useRouter: () => ({
    pathname: "/marketplace",
    push,
  }),
}));

jest.mock("@/components/hooks/use-navigation", () => ({
  __esModule: true,
  default: () => ({
    isHomeActive: true,
    isProfileActive: false,
    isCommunitiesActive: false,
    isMessagesActive: false,
    isWalletActive: false,
    isMyListingsActive: false,
    isCartActive: false,
  }),
}));

jest.mock("@/utils/messages/utils", () => ({
  countNumberOfUnreadMessagesFromChatsContext: jest.fn(async () => 0),
}));

jest.mock("@heroui/react", () => ({
  Button: ({
    children,
    onClick,
  }: {
    children: React.ReactNode;
    onClick?: () => void;
  }) => (
    <button type="button" onClick={onClick}>
      {children}
    </button>
  ),
  Image: ({ alt }: { alt: string }) => <img alt={alt} />,
  useDisclosure: () => ({
    isOpen: false,
    onOpen: jest.fn(),
    onClose: jest.fn(),
  }),
}));

jest.mock("@heroicons/react/24/outline", () => ({
  Bars4Icon: () => <svg data-testid="bars-icon" />,
}));

jest.mock("@/components/sign-in/SignInModal", () => () => null);
jest.mock("@/components/utility-components/profile/profile-dropdown", () => ({
  ProfileWithDropdown: () => <div data-testid="profile-dropdown" />,
}));

function renderTopNav(setSiteLanguage = jest.fn()) {
  return render(
    <ChatsContext.Provider
      value={{
        chatsMap: new Map(),
        setChatsMap: jest.fn(),
        allGiftWrappedMessages: [],
        setAllGiftWrappedMessages: jest.fn(),
      }}
    >
      <ShopMapContext.Provider value={{ shopData: new Map() }}>
        <SignerContext.Provider
          value={{ isLoggedIn: false, pubkey: undefined } as any}
        >
          <SiteLanguageContext.Provider
            value={{ siteLanguage: "en", setSiteLanguage }}
          >
            <TopNav
              setFocusedPubkey={jest.fn()}
              setSelectedSection={jest.fn()}
            />
          </SiteLanguageContext.Provider>
        </SignerContext.Provider>
      </ShopMapContext.Provider>
    </ChatsContext.Provider>
  );
}

describe("TopNav language selector", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("renders language selectors while preserving existing nav controls", () => {
    renderTopNav();

    expect(screen.getAllByLabelText("Language").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Marketplace").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Sign In").length).toBeGreaterThan(0);
  });

  it("updates site language from the selector", () => {
    const setSiteLanguage = jest.fn();
    renderTopNav(setSiteLanguage);

    fireEvent.change(screen.getAllByLabelText("Language")[0]!, {
      target: { value: "es" },
    });

    expect(setSiteLanguage).toHaveBeenCalledWith("es");
  });
});
