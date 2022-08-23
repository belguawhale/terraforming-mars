import * as constants from '../common/constants';
import {BeginnerCorporation} from './cards/corporation/BeginnerCorporation';
import {Board} from './boards/Board';
import {BoardName} from '../common/boards/BoardName';
import {CardFinder} from './CardFinder';
import {CardName} from '../common/cards/CardName';
import {CardType} from '../common/cards/CardType';
import {ClaimedMilestone, serializeClaimedMilestones, deserializeClaimedMilestones} from './milestones/ClaimedMilestone';
import {ColonyDealer} from './colonies/ColonyDealer';
import {IColony} from './colonies/IColony';
import {Color} from '../common/Color';
import {ICorporationCard} from './cards/corporation/ICorporationCard';
import {Database} from './database/Database';
import {Dealer} from './Dealer';
import {FundedAward, serializeFundedAwards, deserializeFundedAwards} from './awards/FundedAward';
import {IAward} from './awards/IAward';
import {IMilestone} from './milestones/IMilestone';
import {IProjectCard} from './cards/IProjectCard';
import {ISpace} from './boards/ISpace';
import {Tile} from './Tile';
import {LogBuilder} from './LogBuilder';
import {LogHelper} from './LogHelper';
import {LogMessage} from '../common/logs/LogMessage';
import {ALL_MILESTONES} from './milestones/Milestones';
import {ALL_AWARDS} from './awards/Awards';
import {PartyHooks} from './turmoil/parties/PartyHooks';
import {Phase} from '../common/Phase';
import {Player} from './Player';
import {PlayerId, GameId, SpectatorId, SpaceId} from '../common/Types';
import {PlayerInput} from './PlayerInput';
import {CardResource} from '../common/CardResource';
import {Resources} from '../common/Resources';
import {DeferredAction, Priority, SimpleDeferredAction} from './deferredActions/DeferredAction';
import {DeferredActionsQueue} from './deferredActions/DeferredActionsQueue';
import {SelectPaymentDeferred} from './deferredActions/SelectPaymentDeferred';
import {SelectInitialCards} from './inputs/SelectInitialCards';
import {PlaceOceanTile} from './deferredActions/PlaceOceanTile';
import {RemoveColonyFromGame} from './deferredActions/RemoveColonyFromGame';
import {GainResources} from './deferredActions/GainResources';
import {SerializedGame} from './SerializedGame';
import {SerializedPlayer} from './SerializedPlayer';
import {SpaceBonus} from '../common/boards/SpaceBonus';
import {SpaceName} from './SpaceName';
import {SpaceType} from '../common/boards/SpaceType';
import {TileType} from '../common/TileType';
import {Turmoil} from './turmoil/Turmoil';
import {RandomMAOptionType} from '../common/ma/RandomMAOptionType';
import {AresHandler} from './ares/AresHandler';
import {AresData} from '../common/ares/AresData';
import {GameSetup} from './GameSetup';
import {GameCards} from './GameCards';
import {GlobalParameter} from '../common/GlobalParameter';
import {AresSetup} from './ares/AresSetup';
import {IMoonData} from './moon/IMoonData';
import {MoonExpansion} from './moon/MoonExpansion';
import {TurmoilHandler} from './turmoil/TurmoilHandler';
import {SeededRandom} from './Random';
import {MilestoneAwardSelector} from './MilestoneAwardSelector';
import {BoardType} from './boards/BoardType';
import {Multiset} from './utils/Multiset';
import {GrantVenusAltTrackBonusDeferred} from './venusNext/GrantVenusAltTrackBonusDeferred';
import {PathfindersExpansion} from './pathfinders/PathfindersExpansion';
import {PathfindersData} from './pathfinders/PathfindersData';
import {AddResourcesToCard} from './deferredActions/AddResourcesToCard';
import {isProduction} from './utils/server';
import {ColonyDeserializer} from './colonies/ColonyDeserializer';
import {GameLoader} from './database/GameLoader';
import {DEFAULT_GAME_OPTIONS, GameOptions} from './GameOptions';
import {ColoniesHandler} from './colonies/ColoniesHandler';
import {TheNewSpaceRace} from './cards/pathfinders/TheNewSpaceRace';

export interface Score {
  corporation: String;
  playerScore: number;
}
export class Game {
  // Game-level data
  public lastSaveId: number = 0;
  private clonedGamedId: string | undefined;
  public rng: SeededRandom;
  public spectatorId: SpectatorId | undefined;
  public deferredActions: DeferredActionsQueue = new DeferredActionsQueue();
  public gameAge: number = 0; // Each log event increases it
  public gameLog: Array<LogMessage> = [];
  public undoCount: number = 0; // Each undo increases it

  public generation: number = 1;
  public phase: Phase = Phase.RESEARCH;
  public dealer: Dealer;
  public board: Board;

  // Global parameters
  private oxygenLevel: number = constants.MIN_OXYGEN_LEVEL;
  private temperature: number = constants.MIN_TEMPERATURE;
  private venusScaleLevel: number = constants.MIN_VENUS_SCALE;

  // Player data
  public activePlayer: PlayerId;
  private donePlayers = new Set<PlayerId>();
  private passedPlayers = new Set<PlayerId>();
  private researchedPlayers = new Set<PlayerId>();
  private draftedPlayers = new Set<PlayerId>();
  // The first player of this generation.
  private first: Player;

  // Drafting
  private draftRound: number = 1;
  // Used when drafting the first 10 project cards.
  private initialDraftIteration: number = 1;
  private unDraftedCards: Map<PlayerId, Array<IProjectCard>> = new Map();
  // Used for corporation global draft: do we draft to next player or to player before
  private corporationsDraftDirection: 'before' | 'after' = 'before';
  public corporationsToDraft: Array<ICorporationCard> = [];

  // Milestones and awards
  public claimedMilestones: Array<ClaimedMilestone> = [];
  public milestones: Array<IMilestone> = [];
  public fundedAwards: Array<FundedAward> = [];
  public awards: Array<IAward> = [];

  // Expansion-specific data
  public colonies: Array<IColony> = [];
  public discardedColonies: Array<IColony> = []; // Not serialized
  public turmoil: Turmoil | undefined;
  public aresData: AresData | undefined;
  public moonData: IMoonData | undefined;
  public pathfindersData: PathfindersData | undefined;

  // Card-specific data
  // Mons Insurance promo corp
  public monsInsuranceOwner?: PlayerId; // Not serialized
  // Crash Site promo project
  public someoneHasRemovedOtherPlayersPlants: boolean = false;
  // Syndicate Pirate Raids
  public syndicatePirateRaider?: PlayerId;

  private constructor(
    public id: GameId,
    private players: Array<Player>,
    first: Player,
    activePlayer: PlayerId,
    public gameOptions: GameOptions,
    rng: SeededRandom,
    board: Board,
    dealer: Dealer) {
    const playerIds = players.map((p) => p.id);
    if (playerIds.includes(first.id) === false) {
      throw new Error('Cannot find first player ' + first.id + ' in ' + playerIds);
    }
    if (playerIds.includes(activePlayer) === false) {
      throw new Error('Cannot find active player ' + activePlayer + ' in ' + playerIds);
    }
    if (new Set(playerIds).size !== players.length) {
      throw new Error('Duplicate player found: ' + playerIds);
    }
    const colors = players.map((p) => p.color);
    if (new Set(colors).size !== players.length) {
      throw new Error('Duplicate color found: ' + colors);
    }

    this.activePlayer = activePlayer;
    this.first = first;
    this.rng = rng;
    this.dealer = dealer;
    this.board = board;

    this.players.forEach((player) => {
      player.game = this;
      if (player.isCorporation(CardName.MONS_INSURANCE)) this.monsInsuranceOwner = player.id;
    });
  }

  public static newInstance(id: GameId,
    players: Array<Player>,
    firstPlayer: Player,
    gameOptions: GameOptions = {...DEFAULT_GAME_OPTIONS},
    seed: number = 0,
    spectatorId: SpectatorId | undefined = undefined): Game {
    if (gameOptions.clonedGamedId !== undefined) {
      throw new Error('Cloning should not come through this execution path.');
    }

    const rng = new SeededRandom(seed);
    const board = GameSetup.newBoard(gameOptions, rng);
    const cardFinder = new CardFinder();
    const cardsForGame = new GameCards(gameOptions);
    const dealer = Dealer.newInstance(cardsForGame);

    const activePlayer = firstPlayer.id;

    // Single player game player starts with 14TR
    if (players.length === 1) {
      gameOptions.draftVariant = false;
      gameOptions.initialDraftVariant = false;
      gameOptions.corporationsDraft = false;
      gameOptions.randomMA = RandomMAOptionType.NONE;

      players[0].setTerraformRating(14);
      players[0].terraformRatingAtGenerationStart = 14;
    }

    const game = new Game(id, players, firstPlayer, activePlayer, gameOptions, rng, board, dealer);
    game.spectatorId = spectatorId;
    // Initialize Ares data
    if (gameOptions.aresExtension) {
      game.aresData = AresSetup.initialData(gameOptions.aresHazards, players);
    }

    const milestonesAwards = MilestoneAwardSelector.chooseMilestonesAndAwards(gameOptions);
    game.milestones = milestonesAwards.milestones;
    game.awards = milestonesAwards.awards;

    // Add colonies stuff
    if (gameOptions.coloniesExtension) {
      const dealer = new ColonyDealer(rng, gameOptions);
      dealer.drawColonies(players.length);
      game.colonies = dealer.colonies;
      game.discardedColonies = dealer.discardedColonies;
    }

    // Add Turmoil stuff
    if (gameOptions.turmoilExtension) {
      game.turmoil = Turmoil.newInstance(game, gameOptions.politicalAgendasExtension);
    }

    // and 2 neutral cities and forests on board
    if (players.length === 1) {
      //  Setup solo player's starting tiles
      GameSetup.setupNeutralPlayer(game);
    }

    // Setup Ares hazards
    if (gameOptions.aresExtension && gameOptions.aresHazards) {
      AresSetup.setupHazards(game, players.length);
    }

    if (gameOptions.moonExpansion) {
      game.moonData = MoonExpansion.initialize();
    }

    if (gameOptions.pathfindersExpansion) {
      game.pathfindersData = PathfindersExpansion.initialize(gameOptions);
    }

    // Setup custom corporation list
    let corporationCards = game.dealer.corporationCards;

    const minCorpsRequired = players.length * gameOptions.startingCorporations;
    if (gameOptions.customCorporationsList && gameOptions.customCorporationsList.length >= minCorpsRequired) {
      const customCorporationCards: ICorporationCard[] = [];
      for (const corp of gameOptions.customCorporationsList) {
        const customCorp = cardFinder.getCorporationCardByName(corp);
        if (customCorp) customCorporationCards.push(customCorp);
      }
      corporationCards = customCorporationCards;
    }

    corporationCards = Dealer.shuffle(corporationCards);

    // Failsafe for exceding corporation pool
    if (gameOptions.startingCorporations * players.length > corporationCards.length) {
      gameOptions.startingCorporations = 2;
    }

    // Initialize each player:
    // Give them their corporation cards, other cards, starting production,
    // handicaps.
    for (const player of game.getPlayersInGenerationOrder()) {
      player.setTerraformRating(player.getTerraformRating() + player.handicap);
      if (!gameOptions.corporateEra) {
        GameSetup.setStartingProductions(player);
      }

      if (!player.beginner ||
        // Bypass beginner choice if any extension is choosen
        gameOptions.preludeExtension ||
        gameOptions.venusNextExtension ||
        gameOptions.coloniesExtension ||
        gameOptions.turmoilExtension ||
        gameOptions.initialDraftVariant) {
        for (let i = 0; i < gameOptions.startingCorporations; i++) {
          const corpCard = corporationCards.pop();
          if (corpCard !== undefined) {
            player.dealtCorporationCards.push(corpCard);
          } else {
            throw new Error('No corporation card dealt for player');
          }
        }
        if (gameOptions.initialDraftVariant === false) {
          for (let i = 0; i < 10; i++) {
            player.dealtProjectCards.push(dealer.dealCard(game));
          }
        }
        if (gameOptions.preludeExtension) {
          for (let i = 0; i < 4; i++) {
            player.dealtPreludeCards.push(dealer.dealPreludeCard());
          }
        }
      } else {
        game.playerHasPickedCorporationCard(player, new BeginnerCorporation());
      }
    }

    // Print game_id if solo game
    if (players.length === 1) {
      game.log('The id of this game is ${0}', (b) => b.rawString(id));
    }

    players.forEach((player) => {
      game.log('Good luck ${0}!', (b) => b.player(player), {reservedFor: player});
    });

    game.log('Generation ${0}', (b) => b.forNewGeneration().number(game.generation));

    // Do we draft corporations or do we start the game?
    if (gameOptions.corporationsDraft) {
      game.phase = Phase.CORPORATIONDRAFTING;
      for (let i = 0; i < gameOptions.startingCorporations * players.length; i++) {
        const card = corporationCards.pop();
        if (card === undefined) throw new Error('No more corporation cards for game ' + id);
        game.corporationsToDraft.push(card);
      }
      // First player should be the last player
      const playerStartingCorporationsDraft = game.getPlayerBefore(firstPlayer);
      if (playerStartingCorporationsDraft !== undefined) {
        playerStartingCorporationsDraft.runDraftCorporationPhase(playerStartingCorporationsDraft.name, game.corporationsToDraft);
      } else {
        // If for any reason, we don't have player before the first one.
        firstPlayer.runDraftCorporationPhase(firstPlayer.name, game.corporationsToDraft);
      }
    } else {
      game.gotoInitialPhase();
    }

    return game;
  }

  // Function use to properly start the game: with project draft or with research phase
  public gotoInitialPhase(): void {
    // Initial Draft
    if (this.gameOptions.initialDraftVariant) {
      this.phase = Phase.INITIALDRAFTING;
      this.runDraftRound(true, false);
    } else {
      this.gotoInitialResearchPhase();
    }
  }

  public save(): void {
    Database.getInstance().saveGame(this);
  }

  public toJSON(): string {
    return JSON.stringify(this.serialize());
  }

  public serialize(): SerializedGame {
    const result: SerializedGame = {
      activePlayer: this.activePlayer,
      awards: this.awards.map((a) => a.name),
      board: this.board.serialize(),
      claimedMilestones: serializeClaimedMilestones(this.claimedMilestones),
      colonies: this.colonies.map((colony) => colony.serialize()),
      currentSeed: this.rng.current,
      dealer: this.dealer.serialize(),
      deferredActions: [],
      donePlayers: Array.from(this.donePlayers),
      draftedPlayers: Array.from(this.draftedPlayers),
      draftRound: this.draftRound,
      first: this.first.id,
      fundedAwards: serializeFundedAwards(this.fundedAwards),
      gameAge: this.gameAge,
      gameLog: this.gameLog,
      gameOptions: this.gameOptions,
      generation: this.generation,
      id: this.id,
      initialDraftIteration: this.initialDraftIteration,
      lastSaveId: this.lastSaveId,
      milestones: this.milestones.map((m) => m.name),
      moonData: IMoonData.serialize(this.moonData),
      oxygenLevel: this.oxygenLevel,
      passedPlayers: Array.from(this.passedPlayers),
      pathfindersData: PathfindersData.serialize(this.pathfindersData),
      phase: this.phase,
      players: this.players.map((p) => p.serialize()),
      researchedPlayers: Array.from(this.researchedPlayers),
      seed: this.rng.seed,
      someoneHasRemovedOtherPlayersPlants: this.someoneHasRemovedOtherPlayersPlants,
      spectatorId: this.spectatorId,
      syndicatePirateRaider: this.syndicatePirateRaider,
      temperature: this.temperature,
      undoCount: this.undoCount,
      unDraftedCards: Array.from(this.unDraftedCards.entries()).map((a) => {
        return [
          a[0],
          a[1].map((c) => c.name),
        ];
      }),
      venusScaleLevel: this.venusScaleLevel,
      corporationsDraftDirection: this.corporationsDraftDirection,
      corporationsToDraft: this.corporationsToDraft.map((c) => c.name),
    };
    if (this.aresData !== undefined) {
      result.aresData = this.aresData;
    }
    if (this.clonedGamedId !== undefined) {
      result.clonedGamedId = this.clonedGamedId;
    }
    if (this.turmoil !== undefined) {
      result.turmoil = this.turmoil.serialize();
    }
    return result;
  }

  public isSoloMode() :boolean {
    return this.players.length === 1;
  }

  // Function to retrieve a player by it's id
  public getPlayerById(id: PlayerId): Player {
    const player = this.players.find((p) => p.id === id);
    if (player === undefined) {
      throw new Error(`player ${id} does not exist on game ${this.id}`);
    }
    return player;
  }

  // Function to return an array of players from an array of player ids
  public getPlayersById(ids: Array<PlayerId>): Array<Player> {
    return ids.map((id) => this.getPlayerById(id));
  }

  public defer(action: DeferredAction, priority?: Priority | number): void {
    if (priority !== undefined) {
      action.priority = priority;
    }
    this.deferredActions.push(action);
  }

  public milestoneClaimed(milestone: IMilestone): boolean {
    return this.claimedMilestones.some(
      (claimedMilestone) => claimedMilestone.milestone.name === milestone.name,
    );
  }

  public marsIsTerraformed(): boolean {
    const oxygenMaxed = this.oxygenLevel >= constants.MAX_OXYGEN_LEVEL;
    const temperatureMaxed = this.temperature >= constants.MAX_TEMPERATURE;
    const oceansMaxed = !this.canAddOcean();
    let globalParametersMaxed = oxygenMaxed && temperatureMaxed && oceansMaxed;
    const venusMaxed = this.getVenusScaleLevel() === constants.MAX_VENUS_SCALE;

    MoonExpansion.ifMoon(this, (moonData) => {
      if (this.gameOptions.requiresMoonTrackCompletion) {
        const moonMaxed =
          moonData.colonyRate === constants.MAXIMUM_COLONY_RATE &&
          moonData.miningRate === constants.MAXIMUM_MINING_RATE &&
          moonData.logisticRate === constants.MAXIMUM_LOGISTICS_RATE;
        globalParametersMaxed = globalParametersMaxed && moonMaxed;
      }
    });

    // Solo games with Venus needs Venus maxed to end the game.
    if (this.players.length === 1 && this.gameOptions.venusNextExtension) {
      return globalParametersMaxed && venusMaxed;
    }
    // new option "requiresVenusTrackCompletion" also makes maximizing Venus a game-end requirement
    if (this.gameOptions.venusNextExtension && this.gameOptions.requiresVenusTrackCompletion) {
      return globalParametersMaxed && venusMaxed;
    }
    return globalParametersMaxed;
  }

  public lastSoloGeneration(): number {
    let lastGeneration = 14;
    const options = this.gameOptions;
    if (options.preludeExtension) {
      lastGeneration -= 2;
    }

    // Only add 2 more generations when using the track completion option
    // and not the solo TR option.
    //
    // isSoloModeWin backs this up.
    if (options.moonExpansion) {
      if (!options.soloTR && options.requiresMoonTrackCompletion) {
        lastGeneration += 2;
      }
    }
    return lastGeneration;
  }

  public isSoloModeWin(): boolean {
    // Solo TR victory condition
    if (this.gameOptions.soloTR) {
      return this.players[0].getTerraformRating() >= 63;
    }

    // Complete terraforing victory condition.
    if (!this.marsIsTerraformed()) {
      return false;
    }

    // This last conditional doesn't make much sense to me. It's only ever really used
    // on the client at components/GameEnd.ts. Which is probably why it doesn't make
    // obvious sense why when this generation is earlier than the last generation
    // of the game means "true, is solo mode win."
    return this.generation <= this.lastSoloGeneration();
  }

  public getAwardFundingCost(): number {
    return 8 + (6 * this.fundedAwards.length);
  }

  public fundAward(player: Player, award: IAward): void {
    if (this.allAwardsFunded()) {
      throw new Error('All awards already funded');
    }
    this.log('${0} funded ${1} award',
      (b) => b.player(player).award(award));

    this.fundedAwards.push({
      award: award,
      player: player,
    });
  }

  public hasBeenFunded(award: IAward): boolean {
    return this.fundedAwards.some(
      (fundedAward) => fundedAward.award.name === award.name,
    );
  }

  public allAwardsFunded(): boolean {
    // Awards are disabled for 1 player games
    if (this.players.length === 1) return true;

    return this.fundedAwards.length >= constants.MAX_AWARDS;
  }

  public allMilestonesClaimed(): boolean {
    // Milestones are disabled for 1 player games
    if (this.players.length === 1) return true;

    return this.claimedMilestones.length >= constants.MAX_MILESTONES;
  }

  private playerHasPickedCorporationCard(player: Player, corporationCard: ICorporationCard): void {
    player.pickedCorporationCard = corporationCard;
    if (this.players.every((p) => p.pickedCorporationCard !== undefined)) {
      for (const somePlayer of this.getPlayersInGenerationOrder()) {
        if (somePlayer.pickedCorporationCard === undefined) {
          throw new Error(`pickedCorporationCard is not defined for ${somePlayer.id}`);
        }
        this.playCorporationCard(somePlayer, somePlayer.pickedCorporationCard);
      }
    }
  }

  // public for testing
  public playCorporationCard(player: Player, corporationCard: ICorporationCard): void {
    if (player.corporations.length === 0) {
      player.corporations.push(corporationCard);
    } else {
      throw new Error('Do not use playCorporationCard for more than one corporation card.');
    }

    player.megaCredits = corporationCard.startingMegaCredits;
    if (corporationCard.cardCost !== undefined) {
      player.cardCost = corporationCard.cardCost;
    }

    if (corporationCard.name !== CardName.BEGINNER_CORPORATION) {
      const diff = player.cardsInHand.length * player.cardCost;
      player.deductResource(Resources.MEGACREDITS, diff);
    }
    corporationCard.play(player);
    if (corporationCard.initialAction !== undefined) player.pendingInitialActions.push(corporationCard);
    this.log('${0} played ${1}', (b) => b.player(player).card(corporationCard));
    player.game.log('${0} kept ${1} project cards', (b) => b.player(player).number(player.cardsInHand.length));

    this.triggerOtherCorpEffects(player, corporationCard);
    ColoniesHandler.onCardPlayed(this, corporationCard);
    PathfindersExpansion.onCardPlayed(player, corporationCard);

    this.playerIsFinishedWithResearchPhase(player);
  }

  public triggerOtherCorpEffects(player: Player, playedCorporationCard: ICorporationCard) {
    // trigger other corp's effects, e.g. SaturnSystems, PharmacyUnion, Splice
    for (const somePlayer of player.game.getPlayers()) {
      for (const corporation of somePlayer.corporations) {
        if (somePlayer === player && corporation.name === playedCorporationCard.name) continue;
        if (corporation.onCorpCardPlayed === undefined) continue;
        this.defer(new SimpleDeferredAction(player, () => corporation.onCorpCardPlayed?.(player, playedCorporationCard)));
      }
    }
  }

  private pickCorporationCard(player: Player): PlayerInput {
    return new SelectInitialCards(player, (corporation: ICorporationCard) => {
      // Check for negative M€
      const cardCost = corporation.cardCost !== undefined ? corporation.cardCost : player.cardCost;
      if (corporation.name !== CardName.BEGINNER_CORPORATION && player.cardsInHand.length * cardCost > corporation.startingMegaCredits) {
        player.cardsInHand = [];
        player.preludeCardsInHand = [];
        throw new Error('Too many cards selected');
      }
      // discard all unpurchased cards
      player.dealtProjectCards.forEach((card) => {
        if (player.cardsInHand.includes(card) === false) {
          this.dealer.discard(card);
        }
      });

      this.playerHasPickedCorporationCard(player, corporation); return undefined;
    });
  }

  public hasPassedThisActionPhase(player: Player): boolean {
    return this.passedPlayers.has(player.id);
  }

  // Public for testing.
  public incrementFirstPlayer(): void {
    let firstIndex: number = this.players.map((x) => x.id).indexOf(this.first.id);
    if (firstIndex === -1) {
      throw new Error('Didn\'t even find player');
    }
    firstIndex = (firstIndex + 1) % this.players.length;
    this.first = this.players[firstIndex];
  }

  // Only used in the prelude The New Space Race.
  public overrideFirstPlayer(newFirstPlayer: Player): void {
    if (newFirstPlayer.game.id !== this.id) {
      throw new Error(`player ${newFirstPlayer.id} is not part of this game`);
    }
    this.first = newFirstPlayer;
  }

  private runDraftRound(initialDraft: boolean = false, preludeDraft: boolean = false): void {
    this.save();
    this.draftedPlayers.clear();
    this.players.forEach((player) => {
      player.needsToDraft = true;
      if (this.draftRound === 1 && !preludeDraft) {
        player.runDraftPhase(initialDraft, this.getNextDraft(player).name);
      } else if (this.draftRound === 1 && preludeDraft) {
        player.runDraftPhase(initialDraft, this.getNextDraft(player).name, player.dealtPreludeCards);
      } else {
        const cards = this.unDraftedCards.get(this.getDraftCardsFrom(player));
        this.unDraftedCards.delete(this.getDraftCardsFrom(player));
        player.runDraftPhase(initialDraft, this.getNextDraft(player).name, cards);
      }
    });
  }

  private gotoInitialResearchPhase(): void {
    this.phase = Phase.RESEARCH;
    this.save();
    for (const player of this.players) {
      if (player.pickedCorporationCard === undefined && player.dealtCorporationCards.length > 0) {
        player.setWaitingFor(this.pickCorporationCard(player));
      }
    }
    if (this.players.length === 1 && this.gameOptions.coloniesExtension) {
      this.players[0].addProduction(Resources.MEGACREDITS, -2);
      this.defer(new RemoveColonyFromGame(this.players[0]));
    }
  }

  private gotoResearchPhase(): void {
    this.phase = Phase.RESEARCH;
    this.researchedPlayers.clear();
    this.save();
    this.players.forEach((player) => {
      player.runResearchPhase(this.gameOptions.draftVariant);
    });
  }

  private gotoDraftingPhase(): void {
    this.phase = Phase.DRAFTING;
    this.draftRound = 1;
    this.runDraftRound();
  }

  public gameIsOver(): boolean {
    if (this.isSoloMode()) {
      // Solo games continue until the designated generation end even if Mars is already terraformed
      return this.generation === this.lastSoloGeneration();
    }
    return this.marsIsTerraformed();
  }

  public isDoneWithFinalProduction(): boolean {
    return this.phase === Phase.END || (this.gameIsOver() && this.phase === Phase.PRODUCTION);
  }

  private gotoProductionPhase(): void {
    this.phase = Phase.PRODUCTION;
    this.passedPlayers.clear();
    this.someoneHasRemovedOtherPlayersPlants = false;
    this.players.forEach((player) => {
      player.cardDiscount = 0; // Iapetus reset hook
      player.runProductionPhase();
    });

    if (this.gameIsOver()) {
      this.log('Final greenery placement', (b) => b.forNewGeneration());
      this.gotoFinalGreeneryPlacement();
      return;
    } else {
      this.players.forEach((player) => {
        player.returnTradeFleets();
      });
    }

    // solar Phase Option
    this.phase = Phase.SOLAR;
    if (this.gameOptions.solarPhaseOption && ! this.marsIsTerraformed()) {
      this.gotoWorldGovernmentTerraforming();
      return;
    }
    this.gotoEndGeneration();
  }

  private endGenerationForColonies() {
    if (this.gameOptions.coloniesExtension) {
      this.colonies.forEach((colony) => {
        colony.endGeneration(this);
      });
      // Syndicate Pirate Raids hook. Also see Colony.ts and Player.ts
      this.syndicatePirateRaider = undefined;
    }
  }

  private gotoEndGeneration() {
    this.endGenerationForColonies();

    Turmoil.ifTurmoil(this, (turmoil) => {
      turmoil.endGeneration(this);
    });

    // turmoil.endGeneration might have added actions.
    if (this.deferredActions.length > 0) {
      this.deferredActions.runAll(() => this.goToDraftOrResearch());
    } else {
      this.phase = Phase.INTERGENERATION;
      this.goToDraftOrResearch();
    }
  }

  private updateVPbyGeneration(): void {
    this.getPlayers().forEach((player) => {
      player.victoryPointsByGeneration.push(player.getVictoryPoints().total);
    });
  }

  private goToDraftOrResearch() {
    this.updateVPbyGeneration();
    this.generation++;
    this.log('Generation ${0}', (b) => b.forNewGeneration().number(this.generation));
    this.incrementFirstPlayer();

    this.players.forEach((player) => {
      player.terraformRatingAtGenerationStart = player.getTerraformRating();
      player.hasIncreasedTerraformRatingThisGeneration = false;
    });

    if (this.gameOptions.draftVariant) {
      this.gotoDraftingPhase();
    } else {
      this.gotoResearchPhase();
    }
  }

  private gotoWorldGovernmentTerraforming() {
    this.first.worldGovernmentTerraforming();
  }

  public doneWorldGovernmentTerraforming() {
    // Carry on to next phase
    this.gotoEndGeneration();
  }

  private allPlayersHavePassed(): boolean {
    for (const player of this.players) {
      if (!this.hasPassedThisActionPhase(player)) {
        return false;
      }
    }
    return true;
  }

  public playerHasPassed(player: Player): void {
    this.passedPlayers.add(player.id);
  }

  public hasResearched(player: Player): boolean {
    return this.researchedPlayers.has(player.id);
  }

  private hasDrafted(player: Player): boolean {
    return this.draftedPlayers.has(player.id);
  }

  private allPlayersHaveFinishedResearch(): boolean {
    for (const player of this.players) {
      if (!this.hasResearched(player)) {
        return false;
      }
    }
    return true;
  }

  private allPlayersHaveFinishedDraft(): boolean {
    for (const player of this.players) {
      if (!this.hasDrafted(player)) {
        return false;
      }
    }
    return true;
  }

  public playerIsFinishedWithResearchPhase(player: Player): void {
    this.deferredActions.runAllFor(player, () => {
      this.researchedPlayers.add(player.id);
      if (this.allPlayersHaveFinishedResearch()) {
        this.phase = Phase.ACTION;
        this.passedPlayers.clear();
        TheNewSpaceRace.potentiallyChangeFirstPlayer(this);
        this.startActionsForPlayer(this.first);
      }
    });
  }

  public playerIsFinishedWithDraftingPhase(initialDraft: boolean, player: Player, cards : Array<IProjectCard>): void {
    this.draftedPlayers.add(player.id);
    this.unDraftedCards.set(player.id, cards);

    player.needsToDraft = false;
    if (this.allPlayersHaveFinishedDraft() === false) {
      return;
    }

    // If more than 1 card are to be passed to the next player, that means we're still drafting
    if (cards.length > 1) {
      this.draftRound++;
      this.runDraftRound(initialDraft);
      return;
    }

    // Push last card for each player
    this.players.forEach((player) => {
      const lastCards = this.unDraftedCards.get(this.getDraftCardsFrom(player));
      if (lastCards !== undefined) {
        player.draftedCards.push(...lastCards);
      }
      player.needsToDraft = undefined;

      if (initialDraft) {
        if (this.initialDraftIteration === 2) {
          player.dealtProjectCards = player.draftedCards;
          player.draftedCards = [];
        } else if (this.initialDraftIteration === 3) {
          player.dealtPreludeCards = player.draftedCards;
          player.draftedCards = [];
        }
      }
    });

    if (initialDraft === false) {
      this.gotoResearchPhase();
      return;
    }

    if (this.initialDraftIteration === 1) {
      this.initialDraftIteration++;
      this.draftRound = 1;
      this.runDraftRound(true);
    } else if (this.initialDraftIteration === 2 && this.gameOptions.preludeExtension) {
      this.initialDraftIteration++;
      this.draftRound = 1;
      this.runDraftRound(true, true);
    } else {
      this.gotoInitialResearchPhase();
    }
  }

  // Function use to manage corporation draft way
  public playerIsFinishedWithDraftingCorporationPhase(player: Player, cards : Array<ICorporationCard>): void {
    const nextPlayer = this.corporationsDraftDirection === 'after' ? this.getPlayerAfter(player) : this.getPlayerBefore(player);
    if (nextPlayer === undefined) {
      throw new Error(`Cannot find player to pass for player ${player.id} in game ${this.id}`);
    }

    const passTo = this.corporationsDraftDirection === 'after' ? this.getPlayerAfter(nextPlayer) : this.getPlayerBefore(nextPlayer);
    if (passTo === undefined) {
      throw new Error(`Cannot find player to pass for player ${nextPlayer.id} in game ${this.id}`);
    }

    // If more than 1 card are to be passed to the next player, that means we're still drafting
    if (cards.length > 1) {
      if ((this.draftRound + 1) % this.players.length === 0) {
        nextPlayer.runDraftCorporationPhase(nextPlayer.name, cards);
      } else if (this.draftRound % this.players.length === 0) {
        player.runDraftCorporationPhase(nextPlayer.name, cards);
        this.corporationsDraftDirection = this.corporationsDraftDirection === 'after' ? 'before' : 'after';
      } else {
        nextPlayer.runDraftCorporationPhase(passTo.name, cards);
      }
      this.draftRound++;
      return;
    }

    // Push last card to next player
    nextPlayer.draftedCorporations.push(...cards);

    this.players.forEach((player) => {
      player.dealtCorporationCards = player.draftedCorporations;
    });
    // Reset value to guarantee no impact on eventual futur drafts (projects or preludes)
    this.initialDraftIteration = 1;
    this.draftRound = 1;
    this.gotoInitialPhase();
  }

  private getDraftCardsFrom(player: Player): PlayerId {
    let nextPlayer: Player | undefined;

    // Change initial draft direction on second iteration
    if (this.generation === 1 && this.initialDraftIteration === 2) {
      nextPlayer = this.getPlayerBefore(player);
    } else if (this.generation % 2 === 1) {
      nextPlayer = this.getPlayerAfter(player);
    } else {
      nextPlayer = this.getPlayerBefore(player);
    }

    if (nextPlayer !== undefined) {
      return nextPlayer.id;
    }
    return player.id;
  }

  private getNextDraft(player: Player): Player {
    let nextPlayer = this.getPlayerAfter(player);
    if (this.generation%2 === 1) {
      nextPlayer = this.getPlayerBefore(player);
    }
    // Change initial draft direction on second iteration
    if (this.initialDraftIteration === 2 && this.generation === 1) {
      nextPlayer = this.getPlayerAfter(player);
    }

    if (nextPlayer !== undefined) {
      return nextPlayer;
    }
    return player;
  }

  private getPlayerBefore(player: Player): Player | undefined {
    const playerIndex: number = this.players.indexOf(player);

    // The player was not found
    if (playerIndex === -1) {
      return undefined;
    }

    // Go to the end of the array if stand at the start
    return this.players[(playerIndex === 0) ? this.players.length - 1 : playerIndex - 1];
  }

  private getPlayerAfter(player: Player): Player | undefined {
    const playerIndex: number = this.players.indexOf(player);

    // The player was not found
    if (playerIndex === -1) {
      return undefined;
    }

    // Go to the beginning of the array if we reached the end
    return this.players[(playerIndex + 1 >= this.players.length) ? 0 : playerIndex + 1];
  }


  public playerIsFinishedTakingActions(): void {
    if (this.deferredActions.length > 0) {
      this.deferredActions.runAll(() => this.playerIsFinishedTakingActions());
      return;
    }

    if (this.allPlayersHavePassed()) {
      this.gotoProductionPhase();
      return;
    }

    const nextPlayer = this.getPlayerAfter(this.getPlayerById(this.activePlayer));

    // Defensive coding to fail fast, if we don't find the next
    // player we are in an unexpected game state
    if (nextPlayer === undefined) {
      throw new Error('Did not find player');
    }

    if (!this.hasPassedThisActionPhase(nextPlayer)) {
      this.startActionsForPlayer(nextPlayer);
    } else {
      // Recursively find the next player
      this.activePlayer = nextPlayer.id;
      this.playerIsFinishedTakingActions();
    }
  }

  private gotoEndGame(): void {
    // Log id or cloned game id
    if (this.clonedGamedId !== undefined && this.clonedGamedId.startsWith('#')) {
      this.log('This game was a clone from game ' + this.clonedGamedId);
    } else {
      this.log('This game id was ' + this.id);
    }

    const scores: Array<Score> = [];
    this.players.forEach((player) => {
      const corpname = player.corporations.length > 0 ? player.corporations[0].name : '';
      const vpb = player.getVictoryPoints();
      scores.push({corporation: corpname, playerScore: vpb.total});
    });

    Database.getInstance().saveGameResults(this.id, this.players.length, this.generation, this.gameOptions, scores);
    this.phase = Phase.END;
    Database.getInstance().saveGame(this).then(() => {
      GameLoader.getInstance().mark(this.id);
      return Database.getInstance().cleanGame(this.id);
    }).catch((err) => {
      console.error(err);
    });
  }

  // Part of final greenery placement.
  public canPlaceGreenery(player: Player): boolean {
    return !this.donePlayers.has(player.id) &&
            player.plants >= player.plantsNeededForGreenery &&
            this.board.getAvailableSpacesForGreenery(player).length > 0;
  }

  // Called when a player cannot or chose not to place any more greeneries.
  public playerIsDoneWithGame(player: Player): void {
    this.donePlayers.add(player.id);
    this.gotoFinalGreeneryPlacement();
  }

  // Well, this isn't just "go to the final greenery placement". It finds the next player
  // who might be able to place a final greenery.
  // Rename to takeNextFinalGreeneryAction?

  public /* for testing */ gotoFinalGreeneryPlacement(): void {
    for (const player of this.getPlayersInGenerationOrder()) {
      if (this.donePlayers.has(player.id)) {
        continue;
      }
      if (this.canPlaceGreenery(player)) {
        this.startFinalGreeneryPlacement(player);
        return;
      } else if (player.getWaitingFor() !== undefined) {
        return;
      } else {
        this.donePlayers.add(player.id);
      }
    }
    this.updateVPbyGeneration();
    this.gotoEndGame();
  }

  private startFinalGreeneryPlacement(player: Player) {
    this.activePlayer = player.id;
    player.takeActionForFinalGreenery();
  }

  private startActionsForPlayer(player: Player) {
    this.activePlayer = player.id;
    player.actionsTakenThisRound = 0;

    player.takeAction();
  }

  public increaseOxygenLevel(player: Player, increments: -2 | -1 | 1 | 2): undefined {
    if (this.oxygenLevel >= constants.MAX_OXYGEN_LEVEL) {
      return undefined;
    }

    // PoliticalAgendas Reds P3 && Magnetic Field Stimulation Delays hook
    if (increments < 0 ) {
      this.oxygenLevel = Math.max(constants.MIN_OXYGEN_LEVEL, this.oxygenLevel + increments);
      return undefined;
    }

    // Literal typing makes |increments| a const
    const steps = Math.min(increments, constants.MAX_OXYGEN_LEVEL - this.oxygenLevel);

    if (this.phase !== Phase.SOLAR) {
      TurmoilHandler.onGlobalParameterIncrease(player, GlobalParameter.OXYGEN, steps);
      player.increaseTerraformRatingSteps(steps);
    }
    if (this.oxygenLevel < 8 && this.oxygenLevel + steps >= 8) {
      this.increaseTemperature(player, 1);
    }

    this.oxygenLevel += steps;

    AresHandler.ifAres(this, (aresData) => {
      AresHandler.onOxygenChange(this, aresData);
    });

    return undefined;
  }

  public getOxygenLevel(): number {
    return this.oxygenLevel;
  }

  public increaseVenusScaleLevel(player: Player, increments: -1 | 1 | 2 | 3): void {
    if (this.venusScaleLevel >= constants.MAX_VENUS_SCALE) {
      return;
    }

    // PoliticalAgendas Reds P3 hook
    if (increments === -1) {
      this.venusScaleLevel = Math.max(constants.MIN_VENUS_SCALE, this.venusScaleLevel + increments * 2);
      return;
    }

    // Literal typing makes |increments| a const
    const steps = Math.min(increments, (constants.MAX_VENUS_SCALE - this.venusScaleLevel) / 2);

    if (this.phase !== Phase.SOLAR) {
      if (this.venusScaleLevel < 8 && this.venusScaleLevel + steps * 2 >= 8) {
        player.drawCard();
      }
      if (this.venusScaleLevel < 16 && this.venusScaleLevel + steps * 2 >= 16) {
        player.increaseTerraformRating();
      }
      if (this.gameOptions.altVenusBoard) {
        const newValue = this.venusScaleLevel + steps * 2;
        const minimalBaseline = Math.max(this.venusScaleLevel, 16);
        const maximumBaseline = Math.min(newValue, 30);
        const standardResourcesGranted = Math.max((maximumBaseline - minimalBaseline) / 2, 0);

        const grantWildResource = this.venusScaleLevel + (steps * 2) >= 30;
        // The second half of this expression removes any increases earler than 16-to-18.
        if (grantWildResource || standardResourcesGranted > 0) {
          this.defer(new GrantVenusAltTrackBonusDeferred(player, standardResourcesGranted, grantWildResource));
        }
      }
      TurmoilHandler.onGlobalParameterIncrease(player, GlobalParameter.VENUS, steps);
      player.increaseTerraformRatingSteps(steps);
    }

    // Check for Aphrodite corporation
    const aphrodite = this.players.find((player) => player.isCorporation(CardName.APHRODITE));
    if (aphrodite !== undefined) {
      aphrodite.megaCredits += steps * 2;
    }

    this.venusScaleLevel += steps * 2;
  }

  public getVenusScaleLevel(): number {
    return this.venusScaleLevel;
  }

  public increaseTemperature(player: Player, increments: -2 | -1 | 1 | 2 | 3): undefined {
    if (this.temperature >= constants.MAX_TEMPERATURE) {
      return undefined;
    }

    if (increments === -2 || increments === -1) {
      this.temperature = Math.max(constants.MIN_TEMPERATURE, this.temperature + increments * 2);
      return undefined;
    }

    // Literal typing makes |increments| a const
    const steps = Math.min(increments, (constants.MAX_TEMPERATURE - this.temperature) / 2);

    if (this.phase !== Phase.SOLAR) {
      // BONUS FOR HEAT PRODUCTION AT -20 and -24
      if (this.temperature < -24 && this.temperature + steps * 2 >= -24) {
        player.addProduction(Resources.HEAT, 1, {log: true});
      }
      if (this.temperature < -20 && this.temperature + steps * 2 >= -20) {
        player.addProduction(Resources.HEAT, 1, {log: true});
      }

      TurmoilHandler.onGlobalParameterIncrease(player, GlobalParameter.TEMPERATURE, steps);
      player.increaseTerraformRatingSteps(steps);
    }

    // BONUS FOR OCEAN TILE AT 0
    if (this.temperature < 0 && this.temperature + steps * 2 >= 0) {
      this.defer(new PlaceOceanTile(player, 'Select space for ocean from temperature increase'));
    }

    this.temperature += steps * 2;

    AresHandler.ifAres(this, (aresData) => {
      AresHandler.onTemperatureChange(this, aresData);
    });

    return undefined;
  }

  public getTemperature(): number {
    return this.temperature;
  }

  public getGeneration(): number {
    return this.generation;
  }

  public getPassedPlayers():Array<Color> {
    const passedPlayersColors: Array<Color> = [];
    this.passedPlayers.forEach((player) => {
      passedPlayersColors.push(this.getPlayerById(player).color);
    });
    return passedPlayersColors;
  }

  public getPlayer(name: string): Player {
    const player = this.players.find((player) => player.name === name);
    if (player === undefined) {
      throw new Error('Player not found');
    }
    return player;
  }

  public getCitiesOnMarsCount(): number {
    return this.board.spaces.filter(
      (space) => Board.isCitySpace(space) && space.spaceType !== SpaceType.COLONY).length;
  }

  public getCitiesCount(player?: Player): number {
    let cities = this.board.spaces.filter(Board.isCitySpace);
    if (player !== undefined) cities = cities.filter(Board.ownedBy(player));
    return cities.length;
  }

  public getGreeneriesCount(player?: Player): number {
    let greeneries = this.board.spaces.filter((space) => Board.isGreenerySpace(space));
    if (player !== undefined) greeneries = greeneries.filter(Board.ownedBy(player));
    return greeneries.length;
  }

  public getSpaceCount(tileType: TileType, player: Player): number {
    return this.board.spaces.filter(Board.ownedBy(player))
      .filter((space) => space.tile?.tileType === tileType)
      .length;
  }

  // addTile applies to the Mars board, but not the Moon board, see MoonExpansion.addTile for placing
  // a tile on The Moon.
  public addTile(
    player: Player, spaceType: SpaceType,
    space: ISpace, tile: Tile): void {
    // Part 1, basic validation checks.

    if (space.tile !== undefined && !(this.gameOptions.aresExtension || this.gameOptions.pathfindersExpansion)) {
      throw new Error('Selected space is occupied');
    }

    // Land claim a player can claim land for themselves
    if (space.player !== undefined && space.player !== player) {
      throw new Error('This space is land claimed by ' + space.player.name);
    }

    let validSpaceType = space.spaceType === spaceType;
    if (space.spaceType === SpaceType.COVE && (spaceType === SpaceType.LAND || spaceType === SpaceType.OCEAN)) {
      // Cove is a valid type for land and also ocean.
      validSpaceType = true;
    }
    if (!validSpaceType) {
      throw new Error(`Select a valid location: ${space.spaceType} is not ${spaceType}`);
    }

    if (!AresHandler.canCover(space, tile)) {
      throw new Error('Selected space is occupied: ' + space.id);
    }

    // Oceans are not subject to Ares adjacency production penalties.
    const subjectToHazardAdjacency = tile.tileType !== TileType.OCEAN;

    AresHandler.ifAres(this, () => {
      AresHandler.assertCanPay(player, space, subjectToHazardAdjacency);
    });

    // Part 2. Collect additional fees.
    // Adjacency costs are before the hellas ocean tile because this is a mandatory cost.
    AresHandler.ifAres(this, () => {
      AresHandler.payAdjacencyAndHazardCosts(player, space, subjectToHazardAdjacency);
    });

    // Hellas special requirements ocean tile
    if (space.id === SpaceName.HELLAS_OCEAN_TILE &&
        this.canAddOcean() &&
        this.gameOptions.boardName === BoardName.HELLAS) {
      if (player.color !== Color.NEUTRAL) {
        this.defer(new PlaceOceanTile(player, 'Select space for ocean from placement bonus'));
        this.defer(new SelectPaymentDeferred(player, constants.HELLAS_BONUS_OCEAN_COST, {title: 'Select how to pay for placement bonus ocean'}));
      }
    }

    TurmoilHandler.resolveTilePlacementCosts(player);

    // Part 3. Setup for bonuses
    const arcadianCommunityBonus = space.player === player && player.isCorporation(CardName.ARCADIAN_COMMUNITIES);
    const initialTileTypeForAres = space.tile?.tileType;
    const coveringExistingTile = space.tile !== undefined;

    // Part 4. Place the tile
    this.simpleAddTile(player, space, tile);

    // Part 5. Collect the bonuses
    if (this.phase !== Phase.SOLAR) {
      if (!coveringExistingTile) {
        this.grantSpaceBonuses(player, space);
      }

      this.board.getAdjacentSpaces(space).forEach((adjacentSpace) => {
        if (Board.isOceanSpace(adjacentSpace)) {
          player.megaCredits += player.oceanBonus;
        }
      });

      AresHandler.ifAres(this, (aresData) => {
        AresHandler.earnAdjacencyBonuses(aresData, player, space);
      });

      TurmoilHandler.resolveTilePlacementBonuses(player, spaceType);

      if (arcadianCommunityBonus) {
        this.defer(new GainResources(player, Resources.MEGACREDITS, {count: 3}));
      }
    } else {
      space.player = undefined;
    }

    this.players.forEach((p) => {
      p.tableau.forEach((playedCard) => {
        playedCard.onTilePlaced?.(p, player, space, BoardType.MARS);
      });
    });

    AresHandler.ifAres(this, () => {
      AresHandler.grantBonusForRemovingHazard(player, initialTileTypeForAres);
    });
  }

  public simpleAddTile(player: Player, space: ISpace, tile: Tile) {
    space.tile = tile;
    space.player = player;
    if (tile.tileType === TileType.OCEAN || tile.tileType === TileType.MARTIAN_NATURE_WONDERS) {
      space.player = undefined;
    }
    LogHelper.logTilePlacement(player, space, tile.tileType);
  }

  public grantSpaceBonuses(player: Player, space: ISpace) {
    const bonuses = new Multiset(space.bonus);
    bonuses.entries().forEach(([bonus, count]) => {
      this.grantSpaceBonus(player, bonus, count);
    });
  }

  public grantSpaceBonus(player: Player, spaceBonus: SpaceBonus, count: number = 1) {
    switch (spaceBonus) {
    case SpaceBonus.DRAW_CARD:
      player.drawCard(count);
      break;
    case SpaceBonus.PLANT:
      player.addResource(Resources.PLANTS, count, {log: true});
      break;
    case SpaceBonus.STEEL:
      player.addResource(Resources.STEEL, count, {log: true});
      break;
    case SpaceBonus.TITANIUM:
      player.addResource(Resources.TITANIUM, count, {log: true});
      break;
    case SpaceBonus.HEAT:
      player.addResource(Resources.HEAT, count, {log: true});
      break;
    case SpaceBonus.OCEAN:
      // ignore
      break;
    case SpaceBonus.MICROBE:
      this.defer(new AddResourcesToCard(player, CardResource.MICROBE, {count: count}));
      break;
    case SpaceBonus.DATA:
      this.defer(new AddResourcesToCard(player, CardResource.DATA, {count: count}));
      break;
    case SpaceBonus.ENERGY_PRODUCTION:
      player.addProduction(Resources.ENERGY, count, {log: true});
      break;
    case SpaceBonus.SCIENCE:
      this.defer(new AddResourcesToCard(player, CardResource.SCIENCE, {count: count}));
      break;
    case SpaceBonus.TEMPERATURE:
      if (this.getTemperature() < constants.MAX_TEMPERATURE) {
        this.defer(new SimpleDeferredAction(player, () => this.increaseTemperature(player, 1)));
        this.defer(new SelectPaymentDeferred(
          player,
          constants.VASTITAS_BOREALIS_BONUS_TEMPERATURE_COST,
          {title: 'Select how to pay for placement bonus temperature'}));
      }
      break;
    case SpaceBonus.ENERGY:
      player.addResource(Resources.ENERGY, count, {log: true});
      break;
    default:
      // TODO(kberg): Remove the isProduction condition after 2022-01-01.
      // I tried this once and broke the server, so I'm wrapping it in isProduction for now.
      if (!isProduction()) {
        throw new Error('Unhandled space bonus ' + spaceBonus);
      }
    }
  }

  public addGreenery(
    player: Player, spaceId: SpaceId,
    spaceType: SpaceType = SpaceType.LAND,
    shouldRaiseOxygen: boolean = true): undefined {
    this.addTile(player, spaceType, this.board.getSpace(spaceId), {
      tileType: TileType.GREENERY,
    });
    // Turmoil Greens ruling policy
    PartyHooks.applyGreensRulingPolicy(player, this.board.getSpace(spaceId));

    if (shouldRaiseOxygen) return this.increaseOxygenLevel(player, 1);
    return undefined;
  }

  public addCityTile(
    player: Player, spaceId: SpaceId, spaceType: SpaceType = SpaceType.LAND,
    cardName: CardName | undefined = undefined): void {
    const space = this.board.getSpace(spaceId);
    this.addTile(player, spaceType, space, {
      tileType: TileType.CITY,
      card: cardName,
    });
  }

  public canAddOcean(): boolean {
    return this.board.getOceanCount() < constants.MAX_OCEAN_TILES;
  }

  public canRemoveOcean(): boolean {
    const count = this.board.getOceanCount();
    return count > 0 && count < constants.MAX_OCEAN_TILES;
  }

  public addOceanTile(
    player: Player, spaceId: SpaceId,
    spaceType: SpaceType = SpaceType.OCEAN): void {
    if (this.canAddOcean() === false) return;

    this.addTile(player, spaceType, this.board.getSpace(spaceId), {
      tileType: TileType.OCEAN,
    });
    if (this.phase !== Phase.SOLAR) {
      TurmoilHandler.onGlobalParameterIncrease(player, GlobalParameter.OCEANS);
      player.increaseTerraformRating();
    }
    AresHandler.ifAres(this, (aresData) => {
      AresHandler.onOceanPlaced(aresData, player);
    });
  }

  public removeTile(spaceId: string): void {
    const space = this.board.getSpace(spaceId);
    space.tile = undefined;
    space.player = undefined;
  }

  public getPlayers(): ReadonlyArray<Player> {
    return this.players;
  }

  // Players returned in play order starting with first player this generation.
  public getPlayersInGenerationOrder(): Array<Player> {
    const ret: Array<Player> = [];
    let insertIdx: number = 0;
    for (const p of this.players) {
      if (p.id === this.first.id || insertIdx > 0) {
        ret.splice(insertIdx, 0, p);
        insertIdx ++;
      } else {
        ret.push(p);
      }
    }
    return ret;
  }

  public getCardPlayer(name: CardName): Player {
    for (const player of this.players) {
      // Check cards player has played
      for (const card of player.tableau) {
        if (card.name === name) {
          return player;
        }
      }
    }
    throw new Error(`No player has played ${name}`);
  }

  // Returns the player holding a card in hand. Return undefined when nobody has that card in hand.
  public getCardHolder(name: CardName): [Player | undefined, IProjectCard | undefined] {
    for (const player of this.players) {
      // Check cards player has in hand
      for (const card of [...player.preludeCardsInHand, ...player.cardsInHand]) {
        if (card.name === name) {
          return [player, card];
        }
      }
    }
    return [undefined, undefined];
  }

  public getCardsInHandByResource(player: Player, resourceType: CardResource) {
    return player.cardsInHand.filter((card) => card.resourceType === resourceType);
  }

  public getCardsInHandByType(player: Player, cardType: CardType) {
    return player.cardsInHand.filter((card) => card.cardType === cardType);
  }

  public log(message: string, f?: (builder: LogBuilder) => void, options?: {reservedFor?: Player}) {
    const builder = new LogBuilder(message);
    if (f) {
      f(builder);
    }
    const logMessage = builder.build();
    logMessage.playerId = options?.reservedFor?.id;
    this.gameLog.push(logMessage);
    this.gameAge++;
  }

  public someoneCanHaveProductionReduced(resource: Resources, minQuantity: number = 1): boolean {
    // in soloMode you don't have to decrease resources
    if (this.isSoloMode()) return true;
    return this.getPlayers().some((p) => {
      if (p.getProduction(resource) < minQuantity) return false;
      // The pathfindersExpansion test is just an optimization for non-Pathfinders games.
      if (this.gameOptions.pathfindersExpansion && p.cardIsInEffect(CardName.PRIVATE_SECURITY)) return false;
      return true;
    });
  }

  public discardForCost(cardCount: 1 | 2, toPlace: TileType) {
    if (cardCount === 1) {
      const card = this.dealer.dealCard(this);
      this.dealer.discard(card);
      this.log('Drew and discarded ${0} (cost ${1}) to place a ${2}', (b) => b.card(card).number(card.cost).tileType(toPlace));
      return card.cost;
    } else {
      const card1 = this.dealer.dealCard(this);
      this.dealer.discard(card1);
      const card2 = this.dealer.dealCard(this);
      this.dealer.discard(card2);
      this.log('Drew and discarded ${0} (cost ${1}) and ${2} (cost ${3}) to place a ${4}', (b) => b.card(card1).number(card1.cost).card(card2).number(card2.cost).tileType(toPlace));
      return card1.cost + card2.cost;
    }
  }

  public getSpaceByOffset(direction: -1 | 1, toPlace: TileType, cardCount: 1 | 2 = 1) {
    const cost = this.discardForCost(cardCount, toPlace);

    const distance = Math.max(cost-1, 0); // Some cards cost zero.
    const space = this.board.getNthAvailableLandSpace(distance, direction, undefined /* player */,
      (space) => {
        const adjacentSpaces = this.board.getAdjacentSpaces(space);
        return adjacentSpaces.every((sp) => sp.tile?.tileType !== TileType.CITY) && // no cities nearby
            adjacentSpaces.some((sp) => this.board.canPlaceTile(sp)); // can place forest nearby
      });
    if (space === undefined) {
      throw new Error('Couldn\'t find space when card cost is ' + cost);
    }
    return space;
  }

  public static deserialize(d: SerializedGame): Game {
    const gameOptions = d.gameOptions;
    const players = d.players.map((element: SerializedPlayer) => Player.deserialize(element, d));
    const first = players.find((player) => player.id === d.first);
    if (first === undefined) {
      throw new Error(`Player ${d.first} not found when rebuilding First Player`);
    }

    const board = GameSetup.deserializeBoard(players, gameOptions, d);

    // Rebuild dealer object to be sure that we will have cards in the same order
    const dealer = Dealer.deserialize(d.dealer);
    const rng = new SeededRandom(d.seed, d.currentSeed);
    const game = new Game(d.id, players, first, d.activePlayer, gameOptions, rng, board, dealer);
    game.spectatorId = d.spectatorId;

    const milestones: Array<IMilestone> = [];
    d.milestones.forEach((element: IMilestone | string) => {
      const milestoneName = typeof element === 'string' ? element : element.name;
      const foundMilestone = ALL_MILESTONES.find((milestone) => milestone.name === milestoneName);
      if (foundMilestone !== undefined) {
        milestones.push(foundMilestone);
      }
    });

    game.milestones = milestones;
    game.claimedMilestones = deserializeClaimedMilestones(d.claimedMilestones, players, milestones);

    const awards: Array<IAward> = [];
    d.awards.forEach((element: IAward | string) => {
      const awardName = typeof element === 'string' ? element : element.name;
      const foundAward = ALL_AWARDS.find((award) => award.name === awardName);
      if (foundAward !== undefined) {
        awards.push(foundAward);
      }
    });

    game.awards = awards;
    game.fundedAwards = deserializeFundedAwards(d.fundedAwards, players, awards);

    if (gameOptions.aresExtension) {
      game.aresData = d.aresData;
    }
    // Reload colonies elements if needed
    if (gameOptions.coloniesExtension) {
      game.colonies = ColonyDeserializer.deserializeAndFilter(d.colonies);
      const dealer = new ColonyDealer(rng, gameOptions);
      dealer.restore(game.colonies);
      game.discardedColonies = dealer.discardedColonies;
    }

    // Reload turmoil elements if needed
    if (d.turmoil && gameOptions.turmoilExtension) {
      game.turmoil = Turmoil.deserialize(d.turmoil);
    }

    // Reload moon elements if needed
    if (d.moonData !== undefined && gameOptions.moonExpansion === true) {
      game.moonData = IMoonData.deserialize(d.moonData, players);
    }

    if (d.pathfindersData !== undefined && gameOptions.pathfindersExpansion === true) {
      game.pathfindersData = PathfindersData.deserialize(d.pathfindersData);
    }

    game.passedPlayers = new Set<PlayerId>(d.passedPlayers);
    game.donePlayers = new Set<PlayerId>(d.donePlayers);
    game.researchedPlayers = new Set<PlayerId>(d.researchedPlayers);
    game.draftedPlayers = new Set<PlayerId>(d.draftedPlayers);

    const cardFinder = new CardFinder();
    // Reinit undrafted cards map
    game.unDraftedCards = new Map<PlayerId, IProjectCard[]>();
    d.unDraftedCards.forEach((unDraftedCard) => {
      game.unDraftedCards.set(unDraftedCard[0], cardFinder.cardsFromJSON(unDraftedCard[1]));
    });

    // TODO(kberg): remove `?? []` by 2022-09-01
    game.corporationsToDraft = cardFinder.corporationCardsFromJSON(d.corporationsToDraft ?? []);
    game.corporationsDraftDirection = d.corporationsDraftDirection ?? false;

    game.lastSaveId = d.lastSaveId;
    game.clonedGamedId = d.clonedGamedId;
    game.gameAge = d.gameAge;
    game.gameLog = d.gameLog;
    game.generation = d.generation;
    game.phase = d.phase;
    game.oxygenLevel = d.oxygenLevel;
    game.undoCount = d.undoCount ?? 0;
    game.temperature = d.temperature;
    game.venusScaleLevel = d.venusScaleLevel;
    game.activePlayer = d.activePlayer;
    game.draftRound = d.draftRound;
    game.initialDraftIteration = d.initialDraftIteration;
    game.someoneHasRemovedOtherPlayersPlants = d.someoneHasRemovedOtherPlayersPlants;
    game.syndicatePirateRaider = d.syndicatePirateRaider;

    // Still in Draft or Research of generation 1
    if (game.generation === 1 && players.some((p) => p.corporations.length === 0)) {
      if (game.phase === Phase.INITIALDRAFTING) {
        if (game.initialDraftIteration === 3) {
          game.runDraftRound(true, true);
        } else {
          game.runDraftRound(true);
        }
      } else {
        game.gotoInitialResearchPhase();
      }
    } else if (game.phase === Phase.DRAFTING) {
      game.runDraftRound();
    } else if (game.phase === Phase.RESEARCH) {
      game.gotoResearchPhase();
    } else if (game.phase === Phase.END) {
      // There's nowhere that we need to go for end game.
    } else {
      // We should be in ACTION phase, let's prompt the active player for actions
      game.getPlayerById(game.activePlayer).takeAction(/* saveBeforeTakingAction */ false);
    }

    if (game.phase === Phase.END) GameLoader.getInstance().mark(game.id);
    return game;
  }

  public logIllegalState(description: string, metadata: {}) {
    const gameMetadata = {
      gameId: this.id,
      lastSaveId: this.lastSaveId,
      logAge: this.gameLog.length,
      currentPlayer: this.activePlayer,

      metadata: metadata,
    };
    console.warn('Illegal state: ' + description, JSON.stringify(gameMetadata, null, ' '));
  }
}